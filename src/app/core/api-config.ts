import { environment } from '../../environments/environment';

// Reads from src/environments — environment.ts (dev, localhost) vs environment.prod.ts (hosted
// Railway services), swapped at build time via angular.json's fileReplacements, same split
// godhan-app's ApiConfig.kt makes with its USE_HOSTED toggle.
export const API_CONFIG = {
  userUrl: environment.userUrl,
  marketplaceUrl: environment.marketplaceUrl,
};
