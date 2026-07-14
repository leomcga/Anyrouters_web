package controller

import (
	"context"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
)

// UpdateVideoTaskAll remains as a compatibility entry point. The service
// poller owns task state transitions and billing so there is only one path.
func UpdateVideoTaskAll(ctx context.Context, platform constant.TaskPlatform, taskChannelM map[int][]string, taskM map[string]*model.Task) error {
	return service.UpdateVideoTasks(ctx, platform, taskChannelM, taskM)
}
