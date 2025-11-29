import { Component, inject, OnDestroy, OnInit, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { 
  Firestore, collection, addDoc, serverTimestamp, 
  query, where, orderBy, onSnapshot, doc, updateDoc, 
  limit, Timestamp, Unsubscribe 
} from '@angular/fire/firestore';
import { Storage, ref, uploadBytesResumable, getDownloadURL } from '@angular/fire/storage';
import { Auth, signInAnonymously, signOut, User, onAuthStateChanged } from '@angular/fire/auth';
import { Observable, of } from 'rxjs';
import { PreformatPipe } from '../../utils/preformat-pipe';

interface Message {
  text?: string;
  senderId: string;
  timestamp: any;
  mediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio';
}

interface IntakeData {
  nome: string;
  telefone: string; // Adicionado
  distribuidora: string;
  regional: string;
  opcaoAtendimento: string;
  siglaSEAL: string;
  componente: string;
  modeloControle: string;
  modoComunicacao: string;
  tipoGprs?: string; // Adicionado
  ip?: string;
  porta?: string;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, PreformatPipe],
  templateUrl: './chat.html',
  styleUrl: './chat.scss'
})
export class Chat implements OnInit, OnDestroy, AfterViewChecked {
  private firestore = inject(Firestore);
  private auth = inject(Auth);
  private storage = inject(Storage);

  userId: string | null = null;
  conversationId: string | null = null;
  messages$: Observable<Message[]> = of([]);
  
  conversationStatus = signal<'loading' | 'pending_intake' | 'queued' | 'active' | 'closed'>('loading');
  queuePosition = signal<number>(0);
  
  isUploading = signal(false);
  uploadPercentage = signal(0);
  isRecording = signal(false);

  private convoUnsub: Unsubscribe | null = null;
  private queueUnsub: Unsubscribe | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: any[] = [];

  regionalsByState: { [key: string]: string[] } = {
    'MA': ['SUL', 'LESTE', 'CENTRO', 'NORTE'],
    'PI': ['METROPOLITANA', 'NORTE', 'SUL', 'CENTRO'],
    'CE': ['METROPOLITANA', 'NORTE', 'SUL', 'CENTRO', 'LESTE', 'OESTE'],
    'GO': ['METROPOLITANA', 'SUL', 'NORTE', 'LESTE', 'OESTE'],
    'TO': ['NORTE', 'SUL', 'CENTRO'],
    'MT': ['NORTE', 'SUL', 'LESTE', 'OESTE', 'CENTRO'],
    'MS': ['CAMPO GRANDE', 'DOURADOS', 'TRÊS LAGOAS', 'CORUMBÁ'],
    'ES': ['NORTE', 'SUL', 'CENTRO', 'SERRANA'],
    'BA': ['SALVADOR', 'FEIRA DE SANTANA', 'VITÓRIA DA CONQUISTA', 'ITABUNA', 'BARREIRAS'],
    'SP': ['CAPITAL', 'GRANDE SP', 'INTERIOR', 'LITORAL'],
    'RJ': ['CAPITAL', 'BAIXADA', 'NITERÓI', 'INTERIOR'],
    'MG': ['BH', 'TRIÂNGULO', 'SUL', 'NORTE', 'LESTE'],
    'PR': ['CURITIBA', 'LONDRINA', 'MARINGÁ', 'OESTE'],
    'SC': ['FLORIANÓPOLIS', 'JOINVILLE', 'BLUMENAU', 'OESTE'],
    'RS': ['PORTO ALEGRE', 'CAXIAS', 'PELOTAS', 'SANTA MARIA'],
    'PE': ['RECIFE', 'CARUARU', 'PETROLINA', 'MATA SUL'],
    'AC': ['CAPITAL', 'INTERIOR'],
    'AL': ['CAPITAL', 'INTERIOR'],
    'AP': ['CAPITAL', 'INTERIOR'],
    'AM': ['CAPITAL', 'INTERIOR'],
    'DF': ['BRASÍLIA'],
    'PB': ['JOÃO PESSOA', 'CAMPINA GRANDE', 'SERTÃO'],
    'RN': ['NATAL', 'MOSSORÓ', 'SERIDÓ'],
    'RO': ['CAPITAL', 'INTERIOR'],
    'RR': ['CAPITAL', 'INTERIOR'],
    'SE': ['CAPITAL', 'INTERIOR']
  };

  @ViewChild('messagesArea') private messagesAreaElement!: ElementRef;
  private shouldScrollToBottom = false;

  ngOnInit() {
    onAuthStateChanged(this.auth, (user) => {
      if (user) {
        this.userId = user.uid;
        this.checkActiveConversation();
      } else {
        signInAnonymously(this.auth).catch(err => console.error("Erro auth anonimo:", err));
      }
    });
  }

  ngOnDestroy() {
    if (this.convoUnsub) this.convoUnsub();
    if (this.queueUnsub) this.queueUnsub();
  }

  ngAfterViewChecked() {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  private scrollToBottom(): void {
    try {
      this.messagesAreaElement.nativeElement.scrollTop = this.messagesAreaElement.nativeElement.scrollHeight;
    } catch(err) { }
  }

  // MÁSCARA DE TELEFONE
  formatPhone(event: any) {
    let v = event.target.value.replace(/\D/g, "");
    v = v.replace(/^(\d\d)(\d)/g, "($1) $2");
    v = v.replace(/(\d{5})(\d)/, "$1-$2");
    event.target.value = v.substring(0, 15);
  }

  async checkActiveConversation() {
    if (!this.userId) return;
    const conversationsRef = collection(this.firestore, 'conversations');
    const q = query(
      conversationsRef, 
      where('userId', '==', this.userId),
      where('status', 'in', ['queued', 'active', 'pending_intake']),
      orderBy('lastMessage.timestamp', 'desc'),
      limit(1)
    );

    this.convoUnsub = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const docSnap = snapshot.docs[0];
        this.conversationId = docSnap.id;
        const data = docSnap.data();
        this.conversationStatus.set(data['status']);
        
        if (data['status'] === 'queued') {
          this.listenToQueuePosition(docSnap.data()['queuedAt']);
        } else {
           this.queuePosition.set(0);
           if (this.queueUnsub) { this.queueUnsub(); this.queueUnsub = null; }
        }

        if (data['status'] === 'active' || data['status'] === 'closed') {
          this.loadMessages(this.conversationId!);
        }
      } else {
        this.conversationStatus.set('pending_intake');
      }
    });
  }

  async submitIntakeForm(form: NgForm) {
    if (form.invalid || !this.userId) return;

    const formData = form.value;
    const ipFinal = formData.ipHidden || formData.ip;
    const portaFinal = formData.portaHidden || formData.porta;

    const intakeData: IntakeData = {
      nome: formData.nome,
      telefone: formData.telefone, // Capturando Telefone
      distribuidora: formData.distribuidora,
      regional: formData.regional,
      opcaoAtendimento: formData.opcaoAtendimento,
      siglaSEAL: formData.siglaSEAL,
      componente: formData.componente,
      modeloControle: formData.modeloControle,
      modoComunicacao: formData.modoComunicacao,
      tipoGprs: formData.tipoGprs || null, // Capturando Tipo GPRS
      ip: ipFinal,
      porta: portaFinal
    };

    try {
      if (this.conversationId) {
        const docRef = doc(this.firestore, 'conversations', this.conversationId);
        await updateDoc(docRef, {
          intakeData: intakeData,
          status: 'queued',
          queuedAt: serverTimestamp(),
          userName: intakeData.nome
        });
      } else {
        await addDoc(collection(this.firestore, 'conversations'), {
          userId: this.userId,
          userName: intakeData.nome,
          status: 'queued',
          createdAt: serverTimestamp(),
          queuedAt: serverTimestamp(),
          lastMessage: { text: 'Solicitação de atendimento iniciada', timestamp: serverTimestamp() },
          intakeData: intakeData
        });
      }
    } catch (e) {
      console.error("Erro intake:", e);
      alert("Erro ao enviar formulário.");
    }
  }

  listenToQueuePosition(myQueuedAt: any) {
    if (!myQueuedAt) return;
    const q = query(
      collection(this.firestore, 'conversations'),
      where('status', '==', 'queued'),
      orderBy('queuedAt', 'asc')
    );
    
    this.queueUnsub = onSnapshot(q, (snapshot) => {
      let pos = 1;
      for (const d of snapshot.docs) {
        if (d.id === this.conversationId) {
          this.queuePosition.set(pos);
          break;
        }
        pos++;
      }
    });
  }

  loadMessages(convId: string) {
    const messagesRef = collection(this.firestore, `conversations/${convId}/messages`);
    const q = query(messagesRef, orderBy('timestamp', 'asc'));
    this.messages$ = new Observable((observer) => {
      return onSnapshot(q, (snap) => {
        const msgs = snap.docs.map(d => d.data() as Message);
        observer.next(msgs);
        setTimeout(() => { this.shouldScrollToBottom = true; }, 100);
      });
    });
  }

  async sendMessage(form: NgForm) {
    if (form.invalid || !this.conversationId || !this.userId) return;
    const text = form.value.message;

    await addDoc(collection(this.firestore, `conversations/${this.conversationId}/messages`), {
      text: text,
      senderId: this.userId,
      timestamp: serverTimestamp()
    });

    await updateDoc(doc(this.firestore, `conversations/${this.conversationId}`), {
      lastMessage: { text: text, timestamp: serverTimestamp() },
      unreadByDashboard: true
    });

    form.reset();
    this.shouldScrollToBottom = true;
  }

  async logout() {
    await signOut(this.auth);
    window.location.reload();
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file && this.conversationId) {
      this.uploadToStorage(file);
    }
    event.target.value = '';
  }

  uploadToStorage(file: File | Blob) {
    if (!this.conversationId) return;
    this.isUploading.set(true);
    const path = `chat_media/${this.conversationId}/${Date.now()}_${(file as File).name || 'audio.webm'}`;
    const storageRef = ref(this.storage, path);
    const task = uploadBytesResumable(storageRef, file);

    task.on('state_changed', 
      (snap) => {
        this.uploadPercentage.set((snap.bytesTransferred / snap.totalBytes) * 100);
      },
      (err) => {
        console.error(err);
        this.isUploading.set(false);
      },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        await this.sendMediaMessage(url, file.type);
        this.isUploading.set(false);
      }
    );
  }

  async sendMediaMessage(url: string, mimeType: string) {
    let type: 'image' | 'video' | 'audio' = 'image';
    if (mimeType.startsWith('video')) type = 'video';
    if (mimeType.startsWith('audio')) type = 'audio';

    await addDoc(collection(this.firestore, `conversations/${this.conversationId}/messages`), {
      senderId: this.userId,
      timestamp: serverTimestamp(),
      mediaUrl: url,
      mediaType: type
    });
    
    await updateDoc(doc(this.firestore, `conversations/${this.conversationId}`), {
      lastMessage: { text: 'Mídia enviada', timestamp: serverTimestamp() },
      unreadByDashboard: true
    });
    this.shouldScrollToBottom = true;
  }

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
      this.mediaRecorder.ondataavailable = (e) => this.audioChunks.push(e.data);
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.uploadToStorage(blob);
        stream.getTracks().forEach(t => t.stop());
      };
      this.mediaRecorder.start();
      this.isRecording.set(true);
    } catch(err) {
      alert("Não foi possível acessar o microfone.");
    }
  }

  stopRecording() {
    if (this.mediaRecorder && this.isRecording()) {
      this.mediaRecorder.stop();
      this.isRecording.set(false);
    }
  }
}