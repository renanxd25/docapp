import { Component, inject, OnInit, ViewChild, OnDestroy, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, of, Subscription, BehaviorSubject, combineLatest } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { IntakeData, Message } from '../../models'; 
import { 
  Firestore, collection, collectionData, query, 
  orderBy, addDoc, serverTimestamp, doc, setDoc, onSnapshot, 
  Timestamp, Unsubscribe, where, limit
} from '@angular/fire/firestore';
import { Auth, authState, signOut, User } from '@angular/fire/auth';
import { Storage, ref, uploadBytesResumable, getDownloadURL } from '@angular/fire/storage';
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
  storage: Storage = inject(Storage);

  private currentConversationId = signal<string | null>(null);
  private localWelcomeMessage = new BehaviorSubject<Message | null>(null);
  private firestoreMessages$!: Observable<Message[]>;
  public messages$!: Observable<Message[]>;
  
  currentUser: User | null = null;
  userId: string | null = null; 

  conversationStatus = signal<'loading' | 'pending_intake' | 'queued' | 'active' | 'closed'>('loading');
  queuePosition = signal(0);
  
  // --- NOVOS SINAIS PARA UPLOAD E GRAVAÇÃO ---
  isUploading = signal(false);
  uploadPercentage = signal(0);
  isRecording = signal(false); // Indica se está gravando áudio
  // -------------------------------------------

  private authSub: Subscription | null = null;
  private convSub: Unsubscribe | null = null; 
  private queueSub: Unsubscribe | null = null; 
  
  // Variáveis para gravação de áudio
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: any[] = [];

  public regionalsByState: { [key: string]: string[] } = {
    'AL': ['CENTRO', 'LESTE', 'OESTE'], 'AP': ['AP'],
    'MA': ['CENTRO', 'LESTE', 'NOROESTE', 'NORTE', 'SUL'],
    'PA': ['CENTRO', 'LESTE', 'NORDESTE', 'NOROESTE', 'NORTE', 'OESTE', 'SUL'],
    'PI': ['CENTRO-SUL', 'METROPOLITANA', 'NORTE', 'SUL'],
    'RS': ['CAMPANHA', 'CARBONIFERA', 'CENTRO', 'LITORAL NORTE', 'LITORAL SUL', 'METROPOLITANA', 'NORDESTE', 'NORTE', 'PORTO ALEGRE', 'SUL'],
    'AC': [], 'AM': [], 'BA': [], 'CE': [], 'DF': [], 'ES': [],
    'GO': [], 'MT': [], 'MS': [], 'MG': [], 'PB': [], 'PR': [],
    'PE': [], 'RJ': [], 'RN': [], 'RO': [], 'RR': [], 'SC': [],
    'SP': [], 'SE': [], 'TO': []
  };

  constructor() {
    const conversationId$ = toObservable(this.currentConversationId);

    this.firestoreMessages$ = conversationId$.pipe(
      switchMap(convoId => {
        if (convoId) {
          const messagesCollection = collection(this.firestore, `conversations/${convoId}/messages`);
          const q = query(messagesCollection, orderBy('timestamp'));
          return collectionData(q, { idField: 'id' }) as Observable<Message[]>;
        }
        return of([]);
      })
    );

    this.messages$ = combineLatest([
      this.localWelcomeMessage.asObservable(),
      this.firestoreMessages$
    ]).pipe(
      map(([welcomeMsg, firestoreMsgs]) => {
        return welcomeMsg ? [welcomeMsg, ...firestoreMsgs] : [...firestoreMsgs];
      })
    );
  }

  ngOnInit() {
    this.authSub = authState(this.auth).subscribe(user => {
      if (user) {
        this.currentUser = user;
        this.userId = user.uid; 
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
      if (snapshot.empty || snapshot.docs[0].data()['status'] === 'closed') {
        this.conversationStatus.set('pending_intake');
        this.currentConversationId.set(null);
        this.localWelcomeMessage.next(null);
      } else {
        const convoDoc = snapshot.docs[0];
        const status = convoDoc.data()['status'];
        this.currentConversationId.set(convoDoc.id); 
        this.conversationStatus.set(status);
        if (status === 'queued') {
          this.listenToQueuePosition(convoDoc.id); 
        } else {
          if (this.queueSub) this.queueSub(); 
          this.queuePosition.set(0);
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

  async submitIntakeForm(form: NgForm) {
    if (form.invalid || !this.currentUser) return;
    const formData = form.value as IntakeData;
    const uid = this.currentUser.uid;
    
    // Auto-preenchimento
    if (formData.modoComunicacao === 'GPRS') formData.ip = '10.1.1.58';
    if (formData.modoComunicacao === 'V2COM') formData.ip = '10.74.150.20';
    if (formData.modoComunicacao === 'TELESPAZIO') formData.porta = '20000';

    const welcomeMessageText = `Bem vindo ao Bot do NOC, ${formData.nome}!\n\nSeu atendimento foi iniciado...`; // (Resumido para caber)
    
    const newConversation = {
      status: 'queued', queuedAt: serverTimestamp(), intakeData: formData, 
      lastMessage: { text: "Cliente entrou na fila de atendimento.", timestamp: serverTimestamp() },
      userId: uid, userName: formData.nome, unreadByDashboard: true
    };
    
    await addDoc(collection(this.firestore, 'conversations'), newConversation);
    const localWelcomeMessage: Message = {
      id: 'local-welcome-msg', text: welcomeMessageText, senderId: uid, 
      timestamp: Timestamp.now()
    };
    this.localWelcomeMessage.next(localWelcomeMessage);
  }

  async sendMessage(form: NgForm) {
    const convoId = this.currentConversationId(); 
    if (!this.currentUser || !convoId) {
      if (this.conversationStatus() === 'closed') { 
        form.reset();
        this.localWelcomeMessage.next(null);
        this.currentConversationId.set(null); 
        this.conversationStatus.set('pending_intake'); 
      }
      return; 
    }
    
    if (form.invalid) return;

    const messageText = form.value.message;
    const uid = this.currentUser.uid;
    const newMessage: Message = {
      text: messageText,
      senderId: uid, 
      timestamp: serverTimestamp() as Timestamp
    };
    
    await addDoc(collection(this.firestore, `conversations/${convoId}/messages`), newMessage);
    await setDoc(doc(this.firestore, `conversations/${convoId}`), {
      lastMessage: { text: messageText, timestamp: serverTimestamp() },
      unreadByDashboard: true
    }, { merge: true }); 

    this.chatForm.reset();
  }

  // --- LÓGICA UNIFICADA DE UPLOAD (ARQUIVO OU BLOB) ---
  
  // 1. Acionado pelo input de arquivo (Galeria ou Câmera)
  onFileSelected(event: any) {
    const file: File = event.target.files[0];
    const convoId = this.currentConversationId();
    if (file && convoId) {
      this.uploadToStorage(file, convoId, file.name);
    }
    event.target.value = ''; 
  }

  // 2. Função genérica que envia para o Firebase
  uploadToStorage(fileOrBlob: File | Blob, conversationId: string, fileName: string) {
    this.isUploading.set(true);
    const filePath = `chat_media/${conversationId}/${Date.now()}_${fileName}`;
    const storageRef = ref(this.storage, filePath);
    const task = uploadBytesResumable(storageRef, fileOrBlob);

    task.on('state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        this.uploadPercentage.set(progress);
      },
      (error) => {
        console.error(error);
        this.isUploading.set(false);
        alert('Erro ao enviar.');
      },
      async () => {
        const downloadURL = await getDownloadURL(task.snapshot.ref);
        await this.sendMediaMessage(downloadURL, fileOrBlob.type, fileName, conversationId);
        this.isUploading.set(false);
      }
    );
  }

  async sendMediaMessage(url: string, mimeType: string, fileName: string, convoId: string) {
    let type: 'image' | 'video' | 'audio' = 'image';
    if (mimeType.startsWith('video')) type = 'video';
    if (mimeType.startsWith('audio')) type = 'audio';

    const msg: Message = {
      senderId: this.currentUser!.uid,
      timestamp: serverTimestamp() as Timestamp,
      mediaUrl: url,
      mediaType: type,
      fileName: fileName
    };

    await addDoc(collection(this.firestore, `conversations/${convoId}/messages`), msg);
    await setDoc(doc(this.firestore, `conversations/${convoId}`), {
      lastMessage: { text: type === 'audio' ? '🎵 Áudio' : '📷 Mídia', timestamp: serverTimestamp() },
      unreadByDashboard: true
    }, { merge: true });
  }

  // --- LÓGICA DE GRAVAÇÃO DE ÁUDIO (MICROFONE) ---

  async toggleRecording() {
    if (this.isRecording()) {
      this.stopRecording();
    } else {
      await this.startRecording();
    }
  }

  async startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        const convoId = this.currentConversationId();
        if (convoId) {
          // Envia o Blob de áudio como se fosse um arquivo
          this.uploadToStorage(audioBlob, convoId, 'gravacao_voz.webm');
        }
        // Para todas as faixas de áudio para desligar o microfone
        stream.getTracks().forEach(track => track.stop());
      };

      this.mediaRecorder.start();
      this.isRecording.set(true);

    } catch (err) {
      console.error("Erro ao acessar microfone:", err);
      alert("Não foi possível acessar o microfone. Verifique as permissões.");
    }
  }

  stopRecording() {
    if (this.mediaRecorder) {
      this.mediaRecorder.stop();
      this.isRecording.set(false);
    }
  }

  async logout() {
    await signOut(this.auth);
    this.router.navigate(['/login']);
  }
}