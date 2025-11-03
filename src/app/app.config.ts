import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes), provideFirebaseApp(() => initializeApp({ projectId: "projetonikolas", appId: "1:1054631751765:web:f56671c042b3cf90a3a4dc", storageBucket: "projetonikolas.firebasestorage.app", apiKey: "AIzaSyB4kNdj4echO_0PuXsP0CkjXP9pS0tmMh0", authDomain: "projetonikolas.firebaseapp.com", messagingSenderId: "1054631751765", measurementId: "G-Y3K9ZZ3RTB"})), provideAuth(() => getAuth()), provideFirestore(() => getFirestore())
  ]
};
