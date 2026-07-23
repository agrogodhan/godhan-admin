# Godhan Admin Portal

Admin web app for the Godhan platform — first pass, covering the admin-gated backend
capabilities built into `marketplace-service` and `user-service` this session (dairy shop
catalog, order fulfillment, offers/coupons, user role management). Built with Angular 22,
standalone components, signals.

## Prerequisites

- `user-service` running on `http://localhost:3001` (real login carries a `role` claim now)
- `marketplace-service` running on `http://localhost:3004` (has CORS enabled for this app)
- An account promoted to `role: "admin"` — see `user-service/scripts/promoteAdmin.mjs`, or ask an
  existing admin to promote you from the Users page once one exists

## Development server

```bash
npm start        # ng serve, defaults to http://localhost:4200
```

Sign in with the same email/password used in the Godhan farmer app. A non-admin account is
rejected at login with a clear message rather than landing on a broken dashboard.

## Pages

- **Dashboard** — user/order counts
- **Dairy Shop Products** — add products to the catalog, adjust stock (`POST /marketplace/product`, `POST /marketplace/product/:id/stock`)
- **Orders** — every order across every farmer, mark delivered/cancelled (`GET/PUT /marketplace/order/all`, `/order/:id/status`)
- **Offers & Coupons** — create/activate/deactivate discount codes; creating one broadcasts a real notification to every farmer (`GET/POST/PUT /marketplace/offers`)
- **Users** — look up any account, promote/demote its role (`GET /api/v1/users`, `PUT /api/v1/users/:id/role`)

## Known gaps (first pass, not yet built)

- No environment-based API URL config — `src/app/core/api-config.ts` is hardcoded to localhost
- No production build/deploy pipeline
- Membership tier management, subscription/feature-flag gating — the underlying platform features
  don't exist yet either, so there's nothing here to manage
- Video-verification booking, micro-hub management — same, no backend yet
