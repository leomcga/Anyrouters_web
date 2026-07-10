package service

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestIsB2BGroup(t *testing.T) {
	tests := []struct {
		group string
		want  bool
	}{
		{group: "btob", want: true},
		{group: "b2b_16", want: true},
		{group: "b2b_enterprise", want: true},
		{group: "default", want: false},
		{group: "vip", want: false},
		{group: "b2b", want: false},
		{group: "b2b_", want: false},
		{group: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.group, func(t *testing.T) {
			require.Equal(t, tt.want, IsB2BGroup(tt.group))
		})
	}
}

func TestIsDedicatedB2BGroup(t *testing.T) {
	tests := []struct {
		group string
		want  bool
	}{
		{group: "b2b_16", want: true},
		{group: "b2b_1", want: true},
		{group: "btob", want: false},
		{group: "b2b_enterprise", want: false},
		{group: "b2b_001", want: false},
		{group: "b2b_0", want: false},
		{group: "b2b_16_extra", want: false},
		{group: "b2b_9223372036854775807", want: true},
		{group: "b2b_9223372036854775808", want: false},
		{group: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.group, func(t *testing.T) {
			require.Equal(t, tt.want, IsDedicatedB2BGroup(tt.group))
		})
	}
}
