import { Routes } from '@angular/router';
import { Shell } from './layout/shell';
import { Login } from './pages/login/login';
import { Dashboard } from './pages/dashboard/dashboard';
import { Products } from './pages/products/products';
import { ShopSettingsPage } from './pages/shop-settings/shop-settings';
import { Bulls } from './pages/bulls/bulls';
import { Breeds } from './pages/breeds/breeds';
import { Orders } from './pages/orders/orders';
import { Offers } from './pages/offers/offers';
import { Users } from './pages/users/users';
import { Finance } from './pages/finance/finance';
import { Reviews } from './pages/reviews/reviews';
import { Knowledge } from './pages/knowledge/knowledge';
import { authGuard, adminGuard } from './core/auth.guard';
import { AuthService } from './core/auth.service';
import { inject } from '@angular/core';

export const routes: Routes = [
  { path: 'login', component: Login },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      // Knowledge review is the only screen a vet can open; everything else is admin-only (adminGuard).
      { path: 'knowledge', component: Knowledge },
      { path: 'dashboard', component: Dashboard, canActivate: [adminGuard] },
      { path: 'products', component: Products, canActivate: [adminGuard] },
      { path: 'shop-settings', component: ShopSettingsPage, canActivate: [adminGuard] },
      { path: 'breeds', component: Breeds, canActivate: [adminGuard] },
      { path: 'bulls', component: Bulls, canActivate: [adminGuard] },
      { path: 'orders', component: Orders, canActivate: [adminGuard] },
      { path: 'offers', component: Offers, canActivate: [adminGuard] },
      { path: 'users', component: Users, canActivate: [adminGuard] },
      { path: 'finance', component: Finance, canActivate: [adminGuard] },
      { path: 'reviews', component: Reviews, canActivate: [adminGuard] },
      { path: '', redirectTo: () => (inject(AuthService).isVet ? 'knowledge' : 'dashboard'), pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: '' },
];
