package model

import (
	"fmt"
	"strings"

	"gorm.io/gorm"
)

type stripeUniqueIndexRequirement struct {
	Table       string
	Name        string
	Column      string
	PartialExpr string
}

type mysqlStripeIndexRow struct {
	TableName  string `gorm:"column:table_name"`
	IndexName  string `gorm:"column:index_name"`
	ColumnName string `gorm:"column:column_name"`
	NonUnique  int    `gorm:"column:non_unique"`
	SeqInIndex int    `gorm:"column:seq_in_index"`
}

type mysqlStripeGeneratedColumn struct {
	TableName            string `gorm:"column:table_name"`
	ColumnName           string `gorm:"column:column_name"`
	GenerationExpression string `gorm:"column:generation_expression"`
}

var stripeUniqueIndexRequirements = []stripeUniqueIndexRequirement{
	{Table: "stripe_payment_orders", Name: "idx_stripe_payment_orders_order_no", Column: "order_no"},
	{Table: "stripe_payment_orders", Name: "idx_stripe_payment_orders_session_unique", Column: "stripe_checkout_session_id", PartialExpr: "stripe_checkout_session_id<>''"},
	{Table: "stripe_payment_orders", Name: "idx_stripe_payment_orders_intent_unique", Column: "stripe_payment_intent_id", PartialExpr: "stripe_payment_intent_id<>''"},
	{Table: "stripe_webhook_events", Name: "idx_stripe_webhook_events_event_id", Column: "stripe_event_id"},
	{Table: "payment_credit_ledgers", Name: "idx_payment_credit_ledgers_operation_key", Column: "operation_key"},
	{Table: "payment_credit_ledgers", Name: "idx_payment_credit_ledgers_order_no", Column: "order_no"},
}

func VerifyStripePaymentSchema(db *gorm.DB) error {
	if db == nil {
		return errorsNewStripeSchema("database is nil")
	}
	switch db.Dialector.Name() {
	case "sqlite":
		return verifySQLiteStripePaymentSchema(db)
	case "mysql":
		return verifyMySQLStripePaymentSchema(db)
	case "postgres":
		return verifyPostgreSQLStripePaymentSchema(db)
	default:
		return errorsNewStripeSchema("unsupported database dialect " + db.Dialector.Name())
	}
}

func errorsNewStripeSchema(message string) error {
	return fmt.Errorf("stripe schema verification failed: %s", message)
}

func normalizeIndexDefinition(value string) string {
	value = strings.ToLower(value)
	replacer := strings.NewReplacer("`", "", `"`, "", "[", "", "]", "", " ", "", "\n", "", "\t", "")
	return replacer.Replace(value)
}

func normalizeMySQLGenerationExpression(value string) string {
	normalized := normalizeIndexDefinition(value)
	normalized = strings.ReplaceAll(normalized, "_utf8mb4", "")
	normalized = strings.ReplaceAll(normalized, "_utf8", "")
	return normalized
}

func verifySQLiteStripePaymentSchema(db *gorm.DB) error {
	for _, requirement := range stripeUniqueIndexRequirements {
		var indexes []struct {
			Name    string `gorm:"column:name"`
			Unique  int    `gorm:"column:unique"`
			Partial int    `gorm:"column:partial"`
		}
		if err := db.Raw("PRAGMA index_list('" + requirement.Table + "')").Scan(&indexes).Error; err != nil {
			return err
		}
		found := false
		for _, index := range indexes {
			if index.Name != requirement.Name || index.Unique != 1 {
				continue
			}
			var columns []struct {
				Name string `gorm:"column:name"`
			}
			if err := db.Raw("PRAGMA index_info('" + requirement.Name + "')").Scan(&columns).Error; err != nil {
				return err
			}
			if len(columns) != 1 || columns[0].Name != requirement.Column {
				continue
			}
			if requirement.PartialExpr != "" {
				var definition string
				if err := db.Raw(
					"SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
					requirement.Name,
				).Scan(&definition).Error; err != nil {
					return err
				}
				if index.Partial != 1 || !strings.Contains(normalizeIndexDefinition(definition), "where"+requirement.PartialExpr) {
					continue
				}
			}
			found = true
			break
		}
		if !found {
			return errorsNewStripeSchema(requirement.Name + " is missing or invalid")
		}
	}
	return nil
}

func verifyPostgreSQLStripePaymentSchema(db *gorm.DB) error {
	var rows []struct {
		TableName string `gorm:"column:tablename"`
		IndexName string `gorm:"column:indexname"`
		IndexDef  string `gorm:"column:indexdef"`
	}
	if err := db.Raw(`
		SELECT tablename, indexname, indexdef
		FROM pg_indexes
		WHERE schemaname = current_schema()
		  AND tablename IN ('stripe_payment_orders', 'stripe_webhook_events', 'payment_credit_ledgers')
	`).Scan(&rows).Error; err != nil {
		return err
	}
	definitions := make(map[string]string, len(rows))
	for _, row := range rows {
		definitions[row.IndexName] = normalizeIndexDefinition(row.IndexDef)
	}
	for _, requirement := range stripeUniqueIndexRequirements {
		definition := definitions[requirement.Name]
		if !strings.Contains(definition, "createuniqueindex") ||
			!strings.Contains(definition, "("+requirement.Column+")") {
			return errorsNewStripeSchema(requirement.Name + " is missing or invalid")
		}
		if requirement.PartialExpr != "" {
			if !strings.Contains(definition, "where") ||
				!strings.Contains(definition, requirement.Column) ||
				!strings.Contains(definition, "<>") ||
				!strings.Contains(definition, "''") {
				return errorsNewStripeSchema(requirement.Name + " has an invalid predicate")
			}
		}
	}
	return nil
}

func verifyMySQLStripePaymentSchema(db *gorm.DB) error {
	var rows []mysqlStripeIndexRow
	if err := db.Raw(`
		SELECT table_name, index_name, column_name, non_unique, seq_in_index
		FROM information_schema.statistics
		WHERE table_schema = DATABASE()
		  AND table_name IN ('stripe_payment_orders', 'stripe_webhook_events', 'payment_credit_ledgers')
	`).Scan(&rows).Error; err != nil {
		return err
	}

	var generated []mysqlStripeGeneratedColumn
	if err := db.Raw(`
		SELECT table_name, column_name, generation_expression
		FROM information_schema.columns
		WHERE table_schema = DATABASE()
		  AND table_name = 'stripe_payment_orders'
		  AND column_name IN ('stripe_checkout_session_unique', 'stripe_payment_intent_unique')
	`).Scan(&generated).Error; err != nil {
		return err
	}
	return validateMySQLStripePaymentSchema(rows, generated)
}

func validateMySQLStripePaymentSchema(rows []mysqlStripeIndexRow, generated []mysqlStripeGeneratedColumn) error {
	indexRows := make(map[string][]mysqlStripeIndexRow)
	for _, row := range rows {
		key := row.TableName + "\x00" + row.IndexName
		indexRows[key] = append(indexRows[key], row)
	}
	expectedIndexes := []struct {
		Table  string
		Name   string
		Column string
	}{
		{Table: "stripe_payment_orders", Name: "idx_stripe_payment_orders_order_no", Column: "order_no"},
		{Table: "stripe_payment_orders", Name: "idx_stripe_payment_orders_session_unique", Column: "stripe_checkout_session_unique"},
		{Table: "stripe_payment_orders", Name: "idx_stripe_payment_orders_intent_unique", Column: "stripe_payment_intent_unique"},
		{Table: "stripe_webhook_events", Name: "idx_stripe_webhook_events_event_id", Column: "stripe_event_id"},
		{Table: "payment_credit_ledgers", Name: "idx_payment_credit_ledgers_operation_key", Column: "operation_key"},
		{Table: "payment_credit_ledgers", Name: "idx_payment_credit_ledgers_order_no", Column: "order_no"},
	}
	for _, expected := range expectedIndexes {
		matches := indexRows[expected.Table+"\x00"+expected.Name]
		if len(matches) != 1 ||
			matches[0].ColumnName != expected.Column ||
			matches[0].NonUnique != 0 ||
			matches[0].SeqInIndex != 1 {
			return errorsNewStripeSchema(expected.Table + "." + expected.Name + " is missing or invalid")
		}
	}

	expressions := make(map[string]string, len(generated))
	for _, column := range generated {
		if column.TableName != "stripe_payment_orders" {
			continue
		}
		expressions[column.ColumnName] = normalizeMySQLGenerationExpression(column.GenerationExpression)
	}
	expectedExpressions := map[string]string{
		"stripe_checkout_session_unique": "nullif(stripe_checkout_session_id,'')",
		"stripe_payment_intent_unique":   "nullif(stripe_payment_intent_id,'')",
	}
	for column, expected := range expectedExpressions {
		if expressions[column] != expected {
			return errorsNewStripeSchema(column + " has an invalid generation expression")
		}
	}
	return nil
}
