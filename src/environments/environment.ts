// Dev config — used by `ng serve` and `ng build` (no --configuration flag). Swapped for
// environment.prod.ts on `ng build --configuration production` via angular.json's
// fileReplacements. Points at the local dev servers the README's Prerequisites section expects.
export const environment = {
  production: false,
  userUrl: 'http://localhost:3001/api/v1',
  marketplaceUrl: 'http://localhost:3004/marketplace',
  cattleUrl: 'http://localhost:3003',
};
