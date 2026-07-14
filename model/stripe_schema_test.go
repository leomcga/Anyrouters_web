package model

import (
	"os"
	"os/exec"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func validMySQLStripeSchemaRows() []mysqlStripeIndexRow {
	return []mysqlStripeIndexRow{
		{TableName: "stripe_payment_orders", IndexName: "idx_stripe_payment_orders_order_no", ColumnName: "order_no", SeqInIndex: 1},
		{TableName: "stripe_payment_orders", IndexName: "idx_stripe_payment_orders_session_unique", ColumnName: "stripe_checkout_session_unique", SeqInIndex: 1},
		{TableName: "stripe_payment_orders", IndexName: "idx_stripe_payment_orders_intent_unique", ColumnName: "stripe_payment_intent_unique", SeqInIndex: 1},
		{TableName: "stripe_webhook_events", IndexName: "idx_stripe_webhook_events_event_id", ColumnName: "stripe_event_id", SeqInIndex: 1},
		{TableName: "payment_credit_ledgers", IndexName: "idx_payment_credit_ledgers_operation_key", ColumnName: "operation_key", SeqInIndex: 1},
		{TableName: "payment_credit_ledgers", IndexName: "idx_payment_credit_ledgers_order_no", ColumnName: "order_no", SeqInIndex: 1},
	}
}

func validMySQLStripeGeneratedColumns() []mysqlStripeGeneratedColumn {
	return []mysqlStripeGeneratedColumn{
		{
			TableName:            "stripe_payment_orders",
			ColumnName:           "stripe_checkout_session_unique",
			GenerationExpression: "NULLIF(`stripe_checkout_session_id`, _utf8mb4'')",
		},
		{
			TableName:            "stripe_payment_orders",
			ColumnName:           "stripe_payment_intent_unique",
			GenerationExpression: " nullif ( `stripe_payment_intent_id` , '' ) ",
		},
	}
}

func TestValidateMySQLStripePaymentSchema(t *testing.T) {
	require.NoError(t, validateMySQLStripePaymentSchema(
		validMySQLStripeSchemaRows(),
		validMySQLStripeGeneratedColumns(),
	))
}

func TestValidateMySQLStripePaymentSchemaRejectsInvalidIndexes(t *testing.T) {
	tests := []struct {
		name   string
		mutate func([]mysqlStripeIndexRow) []mysqlStripeIndexRow
	}{
		{
			name: "same name on wrong table",
			mutate: func(rows []mysqlStripeIndexRow) []mysqlStripeIndexRow {
				rows[0].TableName = "another_table"
				return rows
			},
		},
		{
			name: "wrong column",
			mutate: func(rows []mysqlStripeIndexRow) []mysqlStripeIndexRow {
				rows[0].ColumnName = "wrong_column"
				return rows
			},
		},
		{
			name: "non unique",
			mutate: func(rows []mysqlStripeIndexRow) []mysqlStripeIndexRow {
				rows[0].NonUnique = 1
				return rows
			},
		},
		{
			name: "wrong sequence",
			mutate: func(rows []mysqlStripeIndexRow) []mysqlStripeIndexRow {
				rows[0].SeqInIndex = 2
				return rows
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			require.Error(t, validateMySQLStripePaymentSchema(
				test.mutate(validMySQLStripeSchemaRows()),
				validMySQLStripeGeneratedColumns(),
			))
		})
	}
}

func TestValidateMySQLStripePaymentSchemaRejectsInvalidGeneratedColumns(t *testing.T) {
	tests := []struct {
		name       string
		expression string
	}{
		{name: "upper wrapper", expression: "UPPER(NULLIF(stripe_checkout_session_id, ''))"},
		{name: "wrong field", expression: "NULLIF(stripe_payment_intent_id, '')"},
		{name: "empty expression", expression: ""},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			generated := validMySQLStripeGeneratedColumns()
			generated[0].GenerationExpression = test.expression
			require.Error(t, validateMySQLStripePaymentSchema(
				validMySQLStripeSchemaRows(),
				generated,
			))
		})
	}
}

func TestVerifyStripePaymentSchemaScriptRequiresDBType(t *testing.T) {
	command := exec.Command("../ops/verify-stripe-payment-schema.sh")
	command.Env = removeEnvironmentVariable(os.Environ(), "DB_TYPE")
	output, err := command.CombinedOutput()
	require.Error(t, err)
	require.Contains(t, string(output), "required environment variable is missing: DB_TYPE")
}

func removeEnvironmentVariable(environment []string, name string) []string {
	prefix := name + "="
	filtered := make([]string, 0, len(environment))
	for _, value := range environment {
		if !strings.HasPrefix(value, prefix) {
			filtered = append(filtered, value)
		}
	}
	return filtered
}
