// Dev-only, points at local services the same way godhan-app's ApiConfig.kt does — no build-time
// environment split exists yet, matching this being a first pass at the admin portal.
export const API_CONFIG = {
  userUrl: 'http://localhost:3001/api/v1',
  marketplaceUrl: 'http://localhost:3004/marketplace',
};
