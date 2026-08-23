// Production config — swapped in for environment.ts on `ng build --configuration production`
// (see angular.json's fileReplacements). Points at the hosted Railway services in the
// `cattle-care` project, same public domains godhan-app's ApiConfig.kt uses for HOSTED_USER_HOST/
// HOSTED_MARKETPLACE_HOST.
export const environment = {
  production: true,
  userUrl: 'https://user-service-production-e1a8.up.railway.app/api/v1',
  marketplaceUrl: 'https://marketplace-service-production-55a7.up.railway.app/marketplace',
};
