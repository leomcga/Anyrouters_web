package helper

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"

	"github.com/gin-gonic/gin"
)

const (
	InitialScannerBufferSize    = 64 << 10  // 64KB (64*1024)
	DefaultMaxScannerBufferSize = 128 << 20 // 64MB (64*1024*1024) default SSE buffer size
	DefaultStreamingTimeout     = 300 * time.Second
	DefaultPingInterval         = 10 * time.Second
)

func effectiveStreamingTimeout(seconds int) time.Duration {
	timeout := time.Duration(seconds) * time.Second
	if timeout <= 0 {
		return DefaultStreamingTimeout
	}
	return timeout
}

func getScannerBufferSize() int {
	if constant.StreamScannerMaxBufferMB > 0 {
		return constant.StreamScannerMaxBufferMB << 20
	}
	return DefaultMaxScannerBufferSize
}

func NewStreamScanner(reader io.Reader) *bufio.Scanner {
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, InitialScannerBufferSize), getScannerBufferSize())
	return scanner
}

func StreamScannerHandler(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo, dataHandler func(data string, sr *StreamResult)) {
	if resp == nil || dataHandler == nil {
		return
	}

	info.StreamStatus = relaycommon.NewStreamStatus()
	streamingTimeout := effectiveStreamingTimeout(constant.StreamingTimeout)
	generalSettings := operation_setting.GetGeneralSetting()
	pingEnabled := generalSettings.PingIntervalEnabled && !info.DisablePing
	pingInterval := time.Duration(generalSettings.PingIntervalSeconds) * time.Second
	if pingInterval <= 0 {
		pingInterval = DefaultPingInterval
	}

	logger.LogDebug(c, "relay timeout seconds: %d", common.RelayTimeout)
	logger.LogDebug(c, "relay max idle conns: %d", common.RelayMaxIdleConns)
	logger.LogDebug(c, "relay max idle conns per host: %d", common.RelayMaxIdleConnsPerHost)
	logger.LogDebug(c, "streaming timeout seconds: %d", int64(streamingTimeout.Seconds()))
	logger.LogDebug(c, "ping interval seconds: %d", int64(pingInterval.Seconds()))

	streamScannerHandler(c, resp, info, dataHandler, streamScannerConfig{
		streamingTimeout: streamingTimeout,
		pingEnabled:      pingEnabled,
		pingInterval:     pingInterval,
	})
}

type streamScannerConfig struct {
	streamingTimeout time.Duration
	pingEnabled      bool
	pingInterval     time.Duration
}

type scannerTerminal struct {
	reason relaycommon.StreamEndReason
	err    error
}

func streamScannerHandler(
	c *gin.Context,
	resp *http.Response,
	info *relaycommon.RelayInfo,
	dataHandler func(data string, sr *StreamResult),
	config streamScannerConfig,
) {
	if config.streamingTimeout <= 0 {
		config.streamingTimeout = DefaultStreamingTimeout
	}
	if config.pingInterval <= 0 {
		config.pingInterval = DefaultPingInterval
	}

	requestCtx := c.Request.Context()
	streamCtx, cancelStream := context.WithCancel(requestCtx)
	defer cancelStream()

	var closeBodyOnce sync.Once
	closeBody := func() {
		closeBodyOnce.Do(func() {
			if resp.Body != nil {
				_ = resp.Body.Close()
			}
		})
	}
	defer closeBody()

	stopSignal := common.NewDoneSignal()
	scannerDone := common.NewDoneSignal()
	var stopOnce sync.Once
	stopStream := func(reason relaycommon.StreamEndReason, err error) {
		stopOnce.Do(func() {
			info.StreamStatus.SetEndReason(reason, err)
			stopSignal.Close()
			cancelStream()
			closeBody()
		})
	}

	scanner := NewStreamScanner(resp.Body)
	scanner.Split(bufio.ScanLines)
	SetEventStreamHeaders(c)

	var (
		writeMutex sync.Mutex
		wg         sync.WaitGroup
		pingTicker *time.Ticker
	)

	if config.pingEnabled {
		pingTicker = time.NewTicker(config.pingInterval)
		defer pingTicker.Stop()
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					logger.LogError(c, fmt.Sprintf("ping goroutine panic: %v", r))
					stopStream(relaycommon.StreamEndReasonPanic, fmt.Errorf("ping panic: %v", r))
				}
				logger.LogDebug(c, "ping goroutine exited")
			}()

			for {
				select {
				case <-pingTicker.C:
					writeMutex.Lock()
					err := PingData(c)
					writeMutex.Unlock()
					if err != nil {
						logger.LogError(c, "ping data error: "+err.Error())
						stopStream(relaycommon.StreamEndReasonPingFail, err)
						return
					}
					logger.LogDebug(c, "ping data sent")
				case <-scannerDone.Done():
					return
				case <-stopSignal.Done():
					return
				case <-streamCtx.Done():
					return
				}
			}
		}()
	}

	dataChan := make(chan string, 10)
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer func() {
			if r := recover(); r != nil {
				logger.LogError(c, fmt.Sprintf("data handler goroutine panic: %v", r))
				stopStream(relaycommon.StreamEndReasonPanic, fmt.Errorf("handler panic: %v", r))
			}
		}()

		sr := newStreamResult(info.StreamStatus)
		for {
			select {
			case data, ok := <-dataChan:
				if !ok {
					return
				}
				sr.reset()
				writeMutex.Lock()
				dataHandler(data, sr)
				writeMutex.Unlock()
				if sr.IsStopped() {
					stopStream(info.StreamStatus.EndReason, info.StreamStatus.EndError)
					return
				}
			case <-stopSignal.Done():
				return
			}
		}
	}()

	var terminal scannerTerminal
	activity := make(chan struct{}, 1)
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer func() {
			close(dataChan)
			scannerDone.Close()
			if r := recover(); r != nil {
				logger.LogError(c, fmt.Sprintf("scanner goroutine panic: %v", r))
				stopStream(relaycommon.StreamEndReasonPanic, fmt.Errorf("scanner panic: %v", r))
			}
			logger.LogDebug(c, "scanner goroutine exited")
		}()

		for scanner.Scan() {
			select {
			case <-stopSignal.Done():
				return
			case <-streamCtx.Done():
				return
			default:
			}

			select {
			case activity <- struct{}{}:
			default:
			}

			data := scanner.Text()
			logger.LogDebug(c, "stream scanner data: %s", data)

			if len(data) < 6 {
				continue
			}
			if data[:5] != "data:" && data[:6] != "[DONE]" {
				continue
			}
			data = data[5:]
			data = strings.TrimSpace(data)
			if data == "" {
				continue
			}
			if !strings.HasPrefix(data, "[DONE]") {
				info.SetFirstResponseTime()
				info.ReceivedResponseCount++

				select {
				case dataChan <- data:
				case <-stopSignal.Done():
					return
				case <-streamCtx.Done():
					return
				}
			} else {
				terminal.reason = relaycommon.StreamEndReasonDone
				logger.LogDebug(c, "received [DONE], stopping scanner")
				return
			}
		}

		if err := scanner.Err(); err != nil {
			if err != io.EOF && streamCtx.Err() == nil {
				logger.LogError(c, "scanner error: "+err.Error())
				terminal = scannerTerminal{reason: relaycommon.StreamEndReasonScannerErr, err: err}
				return
			}
		}
		if streamCtx.Err() == nil {
			terminal.reason = relaycommon.StreamEndReasonEOF
		}
	}()

	workersDone := make(chan struct{})
	go func() {
		wg.Wait()
		close(workersDone)
	}()

	idleTimer := time.NewTimer(config.streamingTimeout)
	defer idleTimer.Stop()
	requestDone := requestCtx.Done()
	timeoutChan := idleTimer.C

	for {
		select {
		case <-workersDone:
			if terminal.reason != relaycommon.StreamEndReasonNone {
				info.StreamStatus.SetEndReason(terminal.reason, terminal.err)
			}
			goto finished
		case <-activity:
			if !idleTimer.Stop() {
				select {
				case <-idleTimer.C:
				default:
				}
			}
			idleTimer.Reset(config.streamingTimeout)
		case <-timeoutChan:
			stopStream(relaycommon.StreamEndReasonTimeout, nil)
			timeoutChan = nil
			requestDone = nil
		case <-requestDone:
			stopStream(relaycommon.StreamEndReasonClientGone, requestCtx.Err())
			requestDone = nil
			timeoutChan = nil
		}
	}

finished:
	if info.StreamStatus.IsNormalEnd() && !info.StreamStatus.HasErrors() {
		logger.LogInfo(c, fmt.Sprintf("stream ended: %s", info.StreamStatus.Summary()))
	} else {
		logger.LogError(c, fmt.Sprintf("stream ended: %s, received=%d", info.StreamStatus.Summary(), info.ReceivedResponseCount))
	}
}
