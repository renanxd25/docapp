import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { 
  Auth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  updateProfile
} from '@angular/fire/auth';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class Login {
  auth: Auth = inject(Auth);
  router: Router = inject(Router);
  
  // Signal para controlar se estamos em modo Login ou Cadastro
  isLoginMode = signal(true);
  error: string | null = null;
  loading = false;

  toggleMode() {
    this.isLoginMode.set(!this.isLoginMode());
    this.error = null;
  }

  async onSubmit(form: NgForm) {
    if (form.invalid) return;
    
    this.loading = true;
    this.error = null;
    const { email, password, displayName } = form.value;

    try {
      if (this.isLoginMode()) {
        // --- Modo Login ---
        await signInWithEmailAndPassword(this.auth, email, password);
      } else {
        // --- Modo Cadastro ---
        if (!displayName) {
          this.error = "O nome é obrigatório para o cadastro.";
          this.loading = false;
          return;
        }
        const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
        // Atualiza o perfil do usuário recém-criado com o nome
        await updateProfile(userCredential.user, { displayName: displayName });
      }
      // Se chegou aqui, o login/cadastro funcionou
      this.router.navigate(['/chat']);

    } catch (err: any) {
      this.error = "Erro: " + err.message;
      console.error(err);
    } finally {
      this.loading = false;
    }
  }
}