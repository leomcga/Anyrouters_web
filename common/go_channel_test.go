package common

import (
	"sync"
	"testing"
)

func TestDoneSignalConcurrentCloseOnlyClosesOnce(t *testing.T) {
	signal := NewDoneSignal()

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			signal.Close()
		}()
	}
	wg.Wait()

	select {
	case <-signal.Done():
	default:
		t.Fatal("signal was not closed")
	}

	signal.Close()
	select {
	case <-signal.Done():
	default:
		t.Fatal("signal must remain closed")
	}
}
