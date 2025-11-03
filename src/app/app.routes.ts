import { Routes, CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { Auth, authState } from '@angular/fire/auth';
import { map, take } from 'rxjs/operators';
import { Login } from './components/login/login';
import { Chat } from './components/chat/chat';

// A guarda de rota é idêntica
const authGuard: CanActivateFn = () => {
  const auth: Auth = inject(Auth);
  const router: Router = inject(Router);

  return authState(auth).pipe(
    take(1),
    map(user => {
      if (user) {
        return true; // Usuário logado, pode ir para /chat
      }
      return router.parseUrl('/login'); // Não logado, vai para /login
    })
  );
};

export const routes: Routes = [
  { path: 'login', component: Login },
  {
    path: 'chat',
    component: Chat,
    canActivate: [authGuard] // Protegida
  },
  { path: '', redirectTo: '/chat', pathMatch: 'full' },
  { path: '**', redirectTo: '/login' }
];