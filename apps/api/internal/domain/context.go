package domain

import "context"

type contextKey string

const (
	accountContextKey = contextKey("pdv_account")
	deviceContextKey  = contextKey("pdv_device")
)

func ContextWithAccount(ctx context.Context, a *Account) context.Context {
	return context.WithValue(ctx, accountContextKey, a)
}

func AccountFromContext(ctx context.Context) (*Account, bool) {
	a, ok := ctx.Value(accountContextKey).(*Account)
	return a, ok
}

func ContextWithDevice(ctx context.Context, d *Device) context.Context {
	return context.WithValue(ctx, deviceContextKey, d)
}

func DeviceFromContext(ctx context.Context) (*Device, bool) {
	d, ok := ctx.Value(deviceContextKey).(*Device)
	return d, ok
}
