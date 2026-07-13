package service

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/stripe/stripe-go/v81"
	"github.com/stripe/stripe-go/v81/checkout/session"
)

var StripeCreateCheckoutSession = session.New

func CreateAndBindStripeCheckout(order *model.StripePaymentOrder) (*stripe.CheckoutSession, error) {
	if order == nil || order.OrderNo == "" {
		return nil, errors.New("invalid stripe payment order")
	}
	if order.CheckoutSuccessUrl == "" || order.CheckoutCancelUrl == "" {
		return nil, errors.New("stripe checkout redirect configuration is missing")
	}
	if order.CheckoutUrl != "" && order.StripeCheckoutSessionId != "" {
		return &stripe.CheckoutSession{
			ID:       order.StripeCheckoutSessionId,
			URL:      order.CheckoutUrl,
			Livemode: order.Livemode,
		}, nil
	}

	stripe.Key = setting.StripeApiSecret
	params := &stripe.CheckoutSessionParams{
		ClientReferenceID: stripe.String(order.OrderNo),
		SuccessURL:        stripe.String(order.CheckoutSuccessUrl),
		CancelURL:         stripe.String(order.CheckoutCancelUrl),
		Metadata: map[string]string{
			"order_no":   order.OrderNo,
			"order_kind": order.OrderKind,
		},
	}
	params.SetIdempotencyKey(order.IdempotencyKey)

	switch order.OrderKind {
	case model.StripeOrderKindTopUp:
		params.Mode = stripe.String(string(stripe.CheckoutSessionModePayment))
		params.AllowPromotionCodes = stripe.Bool(false)
		params.LineItems = []*stripe.CheckoutSessionLineItemParams{{
			PriceData: &stripe.CheckoutSessionLineItemPriceDataParams{
				Currency:   stripe.String(order.Currency),
				UnitAmount: stripe.Int64(order.ExpectedAmountMinor),
				ProductData: &stripe.CheckoutSessionLineItemPriceDataProductDataParams{
					Name: stripe.String("Account Credit"),
				},
			},
			Quantity: stripe.Int64(1),
		}}
		params.PaymentIntentData = &stripe.CheckoutSessionPaymentIntentDataParams{
			Metadata: map[string]string{
				"order_no":   order.OrderNo,
				"order_kind": order.OrderKind,
			},
		}
		params.PaymentMethodTypes = stripe.StringSlice([]string{"card", "alipay"})
	case model.StripeOrderKindSubscription:
		if strings.TrimSpace(order.StripePriceId) == "" {
			return nil, errors.New("stripe subscription price id is missing")
		}
		params.Mode = stripe.String(string(stripe.CheckoutSessionModeSubscription))
		params.LineItems = []*stripe.CheckoutSessionLineItemParams{{
			Price:    stripe.String(order.StripePriceId),
			Quantity: stripe.Int64(1),
		}}
		params.SubscriptionData = &stripe.CheckoutSessionSubscriptionDataParams{
			Metadata: map[string]string{
				"order_no":   order.OrderNo,
				"order_kind": order.OrderKind,
			},
		}
	default:
		return nil, errors.New("unsupported stripe payment order kind")
	}

	if order.StripeCustomerId != "" {
		params.Customer = stripe.String(order.StripeCustomerId)
	} else {
		if order.CheckoutCustomerEmail != "" {
			params.CustomerEmail = stripe.String(order.CheckoutCustomerEmail)
		}
		params.CustomerCreation = stripe.String(string(stripe.CheckoutSessionCustomerCreationAlways))
	}

	checkout, err := StripeCreateCheckoutSession(params)
	if err != nil {
		return nil, err
	}
	paymentIntentID := ""
	customerID := order.StripeCustomerId
	if checkout.PaymentIntent != nil {
		paymentIntentID = checkout.PaymentIntent.ID
	}
	if checkout.Customer != nil {
		customerID = checkout.Customer.ID
	}
	if err := model.BindStripeCheckoutSession(
		order.OrderNo,
		checkout.ID,
		paymentIntentID,
		customerID,
		checkout.URL,
		checkout.Livemode,
	); err != nil {
		return nil, err
	}
	return checkout, nil
}
