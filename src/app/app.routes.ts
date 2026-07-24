import { Routes } from '@angular/router';
import { Shell } from './layout/shell';
import { Login } from './pages/login/login';
import { Dashboard } from './pages/dashboard/dashboard';
import { Products } from './pages/products/products';
import { Orders } from './pages/orders/orders';
import { Offers } from './pages/offers/offers';
import { Users } from './pages/users/users';
import { Finance } from './pages/finance/finance';
import { Reviews } from './pages/reviews/reviews';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'login', component: Login },
  {
    path: '',
    component: Shell,
    canActivate: [authGuard],
    children: [
      { path: 'dashboard', component: Dashboard },
      { path: 'products', component: Products },
      { path: 'orders', component: Orders },
      { path: 'offers', component: Offers },
      { path: 'users', component: Users },
      { path: 'finance', component: Finance },
      { path: 'reviews', component: Reviews },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
  { path: '**', redirectTo: '' },
];
