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
  
  // Signals
  isLoginMode = signal(true);
  showPassword = signal(false);
  
  // CORREÇÃO: Transformamos 'error' em signal para atualização imediata na tela
  error = signal<string | null>(null);

  loading = false;

  toggleMode() {
    this.isLoginMode.set(!this.isLoginMode());
    this.error.set(null); // Resetar o signal de erro
  }

  togglePasswordVisibility() {
    this.showPassword.update(value => !value);
  }

  async onSubmit(form: NgForm) {
    if (form.invalid) return;
    
    this.loading = true;
    this.error.set(null); // Limpa o erro antigo
    
    const { email, password, displayName } = form.value;

    try {
      if (this.isLoginMode()) {
        await signInWithEmailAndPassword(this.auth, email, password);
      } else {
        if (!displayName) {
          this.error.set("O nome é obrigatório para o cadastro.");
          this.loading = false;
          return;
        }
        const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
        await updateProfile(userCredential.user, { displayName: displayName });
      }
      
      this.router.navigate(['/chat']);

    } catch (err: any) {
      console.error("Erro Firebase:", err.code);

      // CORREÇÃO: Usamos .set() para notificar a UI imediatamente
      switch(err.code) {
        case 'auth/invalid-credential':
        case 'auth/user-not-found':
        case 'auth/wrong-password':
          this.error.set("E-mail ou senha incorretos.");
          break;
        case 'auth/email-already-in-use':
          this.error.set("Este e-mail já está em uso por outra conta.");
          break;
        case 'auth/invalid-email':
          this.error.set("O formato do e-mail é inválido.");
          break;
        case 'auth/weak-password':
          this.error.set("A senha é muito fraca. Use pelo menos 6 caracteres.");
          break;
        case 'auth/too-many-requests':
          this.error.set("Muitas tentativas falhas. Tente novamente mais tarde.");
          break;
        default:
          this.error.set("Ocorreu um erro inesperado. Tente novamente.");
      }
      
    } finally {
      this.loading = false;
    }
  }
}