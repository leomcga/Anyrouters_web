package oauth

import (
	"context"
	"fmt"

	"github.com/QuantumNous/new-api/logger"
)

func logOAuthExchangeStarted(ctx context.Context, provider string) {
	logger.LogDebug(ctx, "[OAuth-%s] ExchangeToken started", provider)
}

func logOAuthExchangeTransportFailure(ctx context.Context, provider string, err error) {
	logger.LogError(ctx, fmt.Sprintf(
		"[OAuth-%s] ExchangeToken request failed: error_type=%T",
		provider,
		err,
	))
}

func logOAuthExchangeDecodeFailure(ctx context.Context, provider string, err error) {
	logger.LogError(ctx, fmt.Sprintf(
		"[OAuth-%s] ExchangeToken response decode failed: error_type=%T",
		provider,
		err,
	))
}

func logOAuthExchangeResult(
	ctx context.Context,
	provider string,
	status int,
	accessTokenPresent bool,
	refreshTokenPresent bool,
	idTokenPresent bool,
	expiresIn int,
) {
	logger.LogDebug(
		ctx,
		"[OAuth-%s] ExchangeToken result: status=%d access_token_present=%t refresh_token_present=%t id_token_present=%t expires_in=%d",
		provider,
		status,
		accessTokenPresent,
		refreshTokenPresent,
		idTokenPresent,
		expiresIn,
	)
}
