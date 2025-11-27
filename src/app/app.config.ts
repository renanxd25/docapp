import 'zone.js'; // <--- ADICIONE ESTA LINHA OBRIGATORIAMENTE
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getStorage, provideStorage } from '@angular/fire/storage';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }), // Esta linha exige o import acima
    provideRouter(routes),
    
    provideFirebaseApp(() => initializeApp({
      projectId: "projetonikolas", 
      appId: "1:1054631751765:web:f56671c042b3cf90a3a4dc", 
      storageBucket: "projetonikolas.firebasestorage.app", 
      apiKey: "AIzaSyB4kNdj4echO_0PuXsP0CkjXP9pS0tmMh0", 
      authDomain: "projetonikolas.firebaseapp.com", 
      messagingSenderId: "1054631751765", 
      measurementId: "G-Y3K9ZZ3RTB",
      //storageBucket: "projetonikolas.firebasestorage.app",
    })),
    
    provideAuth(() => getAuth()),
    provideFirestore(() => getFirestore()),
    provideStorage(() => getStorage())
  ]
};