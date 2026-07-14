package common

import (
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCustomEventRenderPreservesSSEBehavior(t *testing.T) {
	recorder := httptest.NewRecorder()
	event := CustomEvent{Data: "data: hello"}

	require.NoError(t, event.Render(recorder))
	assert.Equal(t, "text/event-stream", recorder.Header().Get("Content-Type"))
	assert.Equal(t, "no-cache", recorder.Header().Get("Cache-Control"))
	assert.Equal(t, "data: hello\n\n", recorder.Body.String())
}

func TestCustomEventInstancesRenderConcurrently(t *testing.T) {
	const renderers = 20
	var wg sync.WaitGroup
	errs := make(chan error, renderers)

	for i := 0; i < renderers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			recorder := httptest.NewRecorder()
			errs <- (CustomEvent{Data: "data: concurrent"}).Render(recorder)
		}()
	}
	wg.Wait()
	close(errs)

	for err := range errs {
		require.NoError(t, err)
	}
}
