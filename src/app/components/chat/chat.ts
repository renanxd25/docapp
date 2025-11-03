import { Component, inject, OnInit, ViewChild, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
// NOVOS IMPORTS DO RxJS
import { Observable, of, Subscription, BehaviorSubject, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';
// FIM DOS NOVOS IMPORTS
import { IntakeData, Message } from '../../models'; 
import { 
  Firestore, 
  collection, 
  collectionData, 
  query, 
  orderBy, 
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  onSnapshot, 
  DocumentData,
  Timestamp,
  Unsubscribe,
  where
} from '@angular/fire/firestore';
import { Auth, authState, signOut, User } from '@angular/fire/auth';
import { Router } from '@angular/router';
import { PreformatPipe } from '../../utils/preformat-pipe'; 

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, PreformatPipe], 
  templateUrl: './chat.html',
  styleUrl: './chat.scss'
})
export class Chat implements OnInit, OnDestroy {
  @ViewChild('chatForm') chatForm!: NgForm;
  
  firestore: Firestore = inject(Firestore);
  auth: Auth = inject(Auth);
  router: Router = inject(Router);
  
  // --- MUDANÇA NA LÓGICA DOS OBSERVABLES ---
  // Subject para a mensagem de boas-vindas (local)
  private localWelcomeMessage = new BehaviorSubject<Message | null>(null);
  // Observable para as mensagens do Firestore
  private firestoreMessages$!: Observable<Message[]>;
  // Observable principal que o HTML usará (combinado)
  messages$!: Observable<Message[]>;
  // --- FIM DA MUDANÇA ---
  
  currentUser: User | null = null;
  userId: string | null = null; 

  conversationStatus = signal<'loading' | 'pending_intake' | 'queued' | 'active' | 'closed'>('loading');
  queuePosition = signal(0);
  
  private authSub: Subscription | null = null;
  private convSub: Unsubscribe | null = null; 
  private queueSub: Unsubscribe | null = null; 

  ngOnInit() {
    this.authSub = authState(this.auth).subscribe(user => {
      if (user) {
        this.currentUser = user;
        this.userId = user.uid; 
        
        // Carrega as mensagens do Firestore
        this.loadMessages(user.uid); 

        // --- MUDANÇA: Combina os observables ---
        // Agora, messages$ é a combinação da mensagem local + mensagens do firestore
        this.messages$ = combineLatest([
          this.localWelcomeMessage.asObservable(),
          this.firestoreMessages$
        ]).pipe(
          map(([welcomeMsg, firestoreMsgs]) => {
            // Se a mensagem local existir, coloque-a no topo da lista
            const allMessages = welcomeMsg ? [welcomeMsg, ...firestoreMsgs] : [...firestoreMsgs];
            return allMessages;
          })
        );
        // --- FIM DA MUDANÇA ---

        this.listenToConversationStatus(user.uid); 
      } else {
        this.userId = null;
        this.router.navigate(['/login']);
      }
    });
  }

  ngOnDestroy() {
    this.authSub?.unsubscribe();
    if (this.convSub) this.convSub(); 
    if (this.queueSub) this.queueSub(); 
  }

  listenToConversationStatus(uid: string) {
    const convDocRef = doc(this.firestore, `conversations/${uid}`);
    if (this.convSub) this.convSub(); 
    this.convSub = onSnapshot(convDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as DocumentData;
        const newStatus = data['status'] || 'pending_intake';
        this.conversationStatus.set(newStatus);
        if (newStatus === 'queued') {
          this.listenToQueuePosition(uid);
        } else if (this.queueSub) {
          this.queueSub();
          this.queueSub = null;
          this.queuePosition.set(0);
        }
      } else {
        this.conversationStatus.set('pending_intake');
      }
    });
  }

  listenToQueuePosition(uid: string) {
    if (this.queueSub) this.queueSub(); 
    const q = query(
      collection(this.firestore, 'conversations'), 
      where('status', '==', 'queued'), 
      orderBy('queuedAt')               
    );
    this.queueSub = onSnapshot(q, (snapshot) => {
      const myIndex = snapshot.docs.findIndex(doc => doc.id === uid);
      this.queuePosition.set(myIndex > -1 ? myIndex + 1 : 0);
    }, (error) => console.error("Erro ao ouvir a fila: ", error));
  }

  // --- MUDANÇA: Apenas carrega mensagens do firestore ---
  loadMessages(uid: string) {
    const messagesCollection = collection(this.firestore, `conversations/${uid}/messages`);
    const q = query(messagesCollection, orderBy('timestamp'));
    // Atribui ao observable do firestore, não ao messages$ principal
    this.firestoreMessages$ = collectionData(q, { idField: 'id' }) as Observable<Message[]>;
  }
  // --- FIM DA MUDANÇA ---

  // --- MUDANÇA PRINCIPAL AQUI ---
  async submitIntakeForm(form: NgForm) {
    if (form.invalid || !this.currentUser) return;

    const formData = form.value as IntakeData;
    const uid = this.currentUser.uid;

    if (formData.modoComunicacao === 'GPRS') formData.ip = '10.1.1.58';
    if (formData.modoComunicacao === 'V2COM') formData.ip = '10.74.150.20';
    if (formData.modoComunicacao === 'TELESPAZIO') formData.porta = '20000';

    // 1. Cria a mensagem de boas-vindas
    const welcomeMessageText = `Bem vindo ao Bot do NOC, ${formData.nome}!\n\nSeu atendimento foi iniciado com os seguintes dados:\n- Distribuidora: ${formData.distribuidora}\n- Regional: ${formData.regional}\n- Atendimento: ${formData.opcaoAtendimento}\n- SE/AL: ${formData.siglaSEAL}\n- Componente: ${formData.componente}\n- Modelo: ${formData.modeloControle}\n- Comunicação: ${formData.modoComunicacao}\n- IP: ${formData.ip}\n- Porta: ${formData.porta}`;
    
    // 2. Cria o objeto MENSAGEM LOCAL (não será salvo)
    const localWelcomeMessage: Message = {
      id: 'local-welcome-msg',
      text: welcomeMessageText,
      senderId: uid, // Para aparecer como balão azul
      timestamp: Timestamp.now() // Timestamp local
    };

    // 3. Emite a mensagem localmente
    this.localWelcomeMessage.next(localWelcomeMessage);

    // 4. NÃO salvamos mais a mensagem no Firestore.
    // await addDoc(messagesCollection, ...); <-- LINHA REMOVIDA

    // 5. Salva o documento da conversa (isso o admin vê)
    const convDocRef = doc(this.firestore, `conversations/${uid}`);
    await setDoc(convDocRef, {
      status: 'queued', 
      queuedAt: serverTimestamp(), 
      intakeData: formData, // O admin vê os dados aqui
      lastMessage: {
        text: "Cliente entrou na fila de atendimento.", // O admin vê esta mensagem
        timestamp: serverTimestamp()
      },
      userId: uid,
      userName: formData.nome, 
      unreadByDashboard: true
    }, { merge: true });
  }
  // --- FIM DA MUDANÇA PRINCIPAL ---

  async sendMessage(form: NgForm) {
    if (form.invalid || !this.currentUser) return;
    
    if (this.conversationStatus() === 'closed') {
      form.reset();
      
      // --- MUDANÇA: Limpa a mensagem local ---
      this.localWelcomeMessage.next(null);
      // --- FIM DA MUDANÇA ---

      const convDocRef = doc(this.firestore, `conversations/${this.currentUser.uid}`);
      await setDoc(convDocRef, { status: 'pending_intake' }, { merge: true });
      return; 
    }

    // O envio normal de mensagens continua salvando no Firestore
    const messageText = form.value.message;
    const uid = this.currentUser.uid;
    const newMessage: Omit<Message, 'id'> = {
      text: messageText,
      senderId: uid, 
      timestamp: serverTimestamp() as Timestamp
    };
    const messagesCollection = collection(this.firestore, `conversations/${uid}/messages`);
    await addDoc(messagesCollection, newMessage);
    const convDocRef = doc(this.firestore, `conversations/${uid}`);
    await setDoc(convDocRef, {
      lastMessage: {
        text: messageText,
        timestamp: serverTimestamp()
      },
      unreadByDashboard: true
    }, { merge: true }); 

    this.chatForm.reset();
  }

  async logout() {
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }
}