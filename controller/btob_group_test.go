package controller

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestResolveB2BCustomerTarget(t *testing.T) {
	tests := []struct {
		name      string
		userID    int
		requested string
		want      string
		wantErr   bool
	}{
		{name: "empty creates dedicated group", userID: 42, requested: "", want: "b2b_42"},
		{name: "default removes customer from B2B", userID: 42, requested: "default", want: "default"},
		{name: "shared btob is allowed", userID: 42, requested: "btob", want: "btob"},
		{name: "named B2B shared group is allowed", userID: 42, requested: "b2b_enterprise", want: "b2b_enterprise"},
		{name: "ordinary C-end group is rejected", userID: 42, requested: "vip", wantErr: true},
		{name: "malformed B2B group is rejected", userID: 42, requested: "b2b", wantErr: true},
		{name: "empty B2B suffix is rejected", userID: 42, requested: "b2b_", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveB2BCustomerTarget(tt.userID, tt.requested)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			require.Equal(t, tt.want, got)
		})
	}
}
