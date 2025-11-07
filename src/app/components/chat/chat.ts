import { Component, inject, OnInit, ViewChild, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, of, Subscription, BehaviorSubject, combineLatest, EMPTY } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
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
  where,
  limit
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
  
  // --- Injeções ---
  firestore: Firestore = inject(Firestore);
  auth: Auth = inject(Auth);
  router: Router = inject(Router);
  
  // --- Signals ---
  private currentConversationId = signal<string | null>(null);
  conversationStatus = signal<'loading' | 'pending_intake' | 'queued' | 'active' | 'closed'>('loading');
  queuePosition = signal(0);
  
  // --- Subjects (RxJS) ---
  private localWelcomeMessage = new BehaviorSubject<Message | null>(null);
  
  // --- Observables (Definidos no Contexto de Injeção) ---
  
  // Converte o Signal 'currentConversationId' em um Observable
  private conversationId$: Observable<string | null> = toObservable(this.currentConversationId);

  // Define o stream de mensagens do Firestore
  private firestoreMessages$: Observable<Message[]> = this.conversationId$.pipe(
    switchMap(convoId => {
      if (convoId) {
        const messagesCollection = collection(this.firestore, `conversations/${convoId}/messages`);
        const q = query(messagesCollection, orderBy('timestamp'));
        return collectionData(q, { idField: 'id' }) as Observable<Message[]>;
      }
      return of([]); // Retorna array vazio se não houver ID
    })
  );

  // Define o stream final de mensagens para o HTML
  public messages$: Observable<Message[]> = combineLatest([
    this.localWelcomeMessage.asObservable(),
    this.firestoreMessages$
  ]).pipe(
    map(([welcomeMsg, firestoreMsgs]) => {
      return welcomeMsg ? [welcomeMsg, ...firestoreMsgs] : [...firestoreMsgs];
    })
  );

  // --- Propriedades da Classe ---
  currentUser: User | null = null;
  userId: string | null = null; 
  
  private authSub: Subscription | null = null;
  private convSub: Unsubscribe | null = null; 
  private queueSub: Unsubscribe | null = null; 

  public regionalsByState: { [key: string]: string[] } = {
    'AL': ['CENTRO', 'LESTE', 'OESTE'],
    'AP': ['AP'],
    'MA': ['CENTRO', 'LESTE', 'NOROESTE', 'NORTE', 'SUL'],
    'PA': ['CENTRO', 'LESTE', 'NORDESTE', 'NOROESTE', 'NORTE', 'OESTE', 'SUL'],
    'PI': ['CENTRO-SUL', 'METROPOLITANA', 'NORTE', 'SUL'],
    'RS': ['CAMPANHA', 'CARBONIFERA', 'CENTRO', 'LITORAL NORTE', 'LITORAL SUL', 'METROPOLITANA', 'NORDESTE', 'NORTE', 'PORTO ALEGRE', 'SUL'],
    'AC': [], 'AM': [], 'BA': [], 'CE': [], 'DF': [], 'ES': [],
    'GO': [], 'MT': [], 'MS': [], 'MG': [], 'PB': [], 'PR': [],
    'PE': [], 'RJ': [], 'RN': [], 'RO': [], 'RR': [], 'SC': [],
    'SP': [], 'SE': [], 'TO': []
  };

  ngOnInit() {
    // A única subscrição manual que precisamos
    this.authSub = authState(this.auth).subscribe(user => {
      if (user) {
        this.currentUser = user;
        this.userId = user.uid; 
        
        // Apenas iniciamos o listener.
        // Ele vai atualizar o signal 'currentConversationId',
        // e os observables (messages$) reagirão automaticamente.
        this.listenForActiveConversation(user.uid); 

      } else {
        this.userId = null;
        this.currentUser = null;
        this.router.navigate(['/login']);
      }
    });
  }

  ngOnDestroy() {
    this.authSub?.unsubscribe();
    if (this.convSub) this.convSub(); 
    if (this.queueSub) this.queueSub(); 
  }

  listenForActiveConversation(uid: string) {
    if (this.convSub) this.convSub(); 

    const q = query(
      collection(this.firestore, 'conversations'),
      where('userId', '==', uid), 
      where('status', 'in', ['queued', 'active', 'closed']), 
      orderBy('queuedAt', 'desc'), 
      limit(1) 
    );

    this.convSub = onSnapshot(q, (snapshot) => {
      if (snapshot.empty) {
        this.conversationStatus.set('pending_intake');
        this.currentConversationId.set(null);
        this.localWelcomeMessage.next(null);
      } else {
        const convoDoc = snapshot.docs[0];
        const status = convoDoc.data()['status'];
        
        if (status === 'closed') {
          this.conversationStatus.set('pending_intake');
          this.currentConversationId.set(null);
          this.localWelcomeMessage.next(null);
        } else {
          // Define o ID da conversa e o status
          this.currentConversationId.set(convoDoc.id); 
          this.conversationStatus.set(status);
          
          if (status === 'queued') {
            this.listenToQueuePosition(convoDoc.id); 
          } else {
            if (this.queueSub) this.queueSub(); 
            this.queuePosition.set(0);
          }
        }
      }
    });
  }

  listenToQueuePosition(conversationId: string) {
    if (this.queueSub) this.queueSub(); 
    const q = query(
      collection(this.firestore, 'conversations'), 
      where('status', '==', 'queued'), 
      orderBy('queuedAt')               
    );
    this.queueSub = onSnapshot(q, (snapshot) => {
      const myIndex = snapshot.docs.findIndex(doc => doc.id === conversationId);
      this.queuePosition.set(myIndex > -1 ? myIndex + 1 : 0);
    }, (error) => console.error("Erro ao ouvir a fila: ", error));
  }

  // A função 'loadMessages' foi removida, 
  // pois sua lógica agora está na definição de 'firestoreMessages$'.

  async submitIntakeForm(form: NgForm) {
    if (form.invalid || !this.currentUser) return;

    const formData = form.value as IntakeData;
    const uid = this.currentUser.uid;

    if (formData.modoComunicacao === 'GPRS') formData.ip = '10.1.1.58';
    if (formData.modoComunicacao === 'V2COM') formData.ip = '10.74.150.20';
    if (formData.modoComunicacao === 'TELESPAZIO') formData.porta = '20000';

    const welcomeMessageText = `Bem vindo ao Bot do NOC, ${formData.nome}!\n\nSeu atendimento foi iniciado com os seguintes dados:\n- Distribuidora: ${formData.distribuidora}\n- Regional: ${formData.regional}\n- Atendimento: ${formData.opcaoAtendimento}\n- SE/AL: ${formData.siglaSEAL}\n- Componente: ${formData.componente}\n- Modelo: ${formData.modeloControle}\n- Comunicação: ${formData.modoComunicacao}\n- IP: ${formData.ip}\n- Porta: ${formData.porta}`;
    
    const newConversation = {
      status: 'queued', 
      queuedAt: serverTimestamp(), 
      intakeData: formData, 
      lastMessage: {
        text: "Cliente entrou na fila de atendimento.",
        timestamp: serverTimestamp()
      },
      userId: uid, 
      userName: formData.nome, 
      unreadByDashboard: true
    };
    
    const docRef = await addDoc(collection(this.firestore, 'conversations'), newConversation);
    
    const localWelcomeMessage: Message = {
      id: 'local-welcome-msg',
      text: welcomeMessageText,
      senderId: uid, 
      timestamp: Timestamp.now()
    };
    this.localWelcomeMessage.next(localWelcomeMessage);
    // O 'listenForActiveConversation' pegará a nova conversa.
  }

  async sendMessage(form: NgForm) {
    const convoId = this.currentConversationId(); 
    if (form.invalid || !this.currentUser || !convoId) {
      
      // Lógica de fallback se o usuário tentar enviar no estado 'closed'
      if (this.conversationStatus() === 'closed') { 
        form.reset();
        this.localWelcomeMessage.next(null);
        this.currentConversationId.set(null); 
        this.conversationStatus.set('pending_intake'); 
      }
      return; 
    }

    const messageText = form.value.message;
    const uid = this.currentUser.uid;
    const newMessage: Omit<Message, 'id'> = {
      text: messageText,
      senderId: uid, 
      timestamp: serverTimestamp() as Timestamp
    };
    
    const messagesCollection = collection(this.firestore, `conversations/${convoId}/messages`);
    await addDoc(messagesCollection, newMessage);
    
    const convDocRef = doc(this.firestore, `conversations/${convoId}`);
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