package common

import "sync"

// DoneSignal is a close-only broadcast signal. The creator owns the signal,
// receivers only observe Done, and Close is safe to call concurrently.
type DoneSignal struct {
	once sync.Once
	done chan struct{}
}

func NewDoneSignal() *DoneSignal {
	return &DoneSignal{done: make(chan struct{})}
}

func (s *DoneSignal) Done() <-chan struct{} {
	if s == nil {
		return nil
	}
	return s.done
}

func (s *DoneSignal) Close() {
	if s == nil {
		return
	}
	s.once.Do(func() {
		close(s.done)
	})
}
