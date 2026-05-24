import { Component, inject, OnDestroy, OnInit, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { 
  Firestore, collection, addDoc, serverTimestamp, 
  query, where, orderBy, onSnapshot, doc, updateDoc, 
  limit, Timestamp, Unsubscribe, DocumentChange 
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
  telefone: string;
  distribuidora: string;
  regional: string;
  opcaoAtendimento: string;
  
  subestacao: string;
  alimentador: string;
  
  componente: string;
  classeComponente: string;
  modelo: string;
  rele?: string; 

  modoComunicacao: string;
  
  tipoGprs?: string;
  tipoSatelital?: string; 
  tipoFibra?: string; 
  
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

  selectedOpcao: string = '';
  selectedModo: string = '';
  selectedTipoSatelital: string = ''; 

  selectedClasse: string = '';
  selectedModelo: string = '';
  selectedRele: string = '';

  private convoUnsub: Unsubscribe | null = null;
  private queueUnsub: Unsubscribe | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: any[] = [];

  modelsByClass: { [key: string]: string[] } = {
    'CHAVE TELECOMANDA': ['BONOMI', 'IMS'],
    'RELIGADOR': ['ARTECHE', 'COOPER', 'G&W', 'NOJA', 'SCHNEIDER', 'SIEMENS', 'TAVRIDA'],
    'REGULADOR': ['ITB','TAPELATRO'],
    'SENSOR': ['MT', 'KOALA']
  };

  relaysByRecloserModel: { [key: string]: string[] } = {
    'ARTECHE': ['ADATECH', 'SEL 351R', 'SEL 7511', 'SEL 751A', 'SEL 751A STD'],
    'COOPER': ['FORM 6', 'LBS', 'SEL 651R', 'SEL 7511'],
    'G&W': ['SEL 7511'],
    'NOJA': ['RC 10'],
    'SCHNEIDER': ['ADVC', 'ADVC 2', 'ADVC 3', 'PTCC'],
    'SIEMENS': ['7SC80'],
    'TAVRIDA': ['RC 5', 'SEL 751A (CREATE)', 'SEL 751A (ECIL)'],
    'ITB': ['CTR3'],
    'TAPELATRO': ['RUA']
  };

  regionalsByState: { [key: string]: string[] } = {
    'AL': [ 'LESTE', 'OESTE'],
    'AP': ['AP'],
    'GO': ['ANÁPOLIS', 'FORMOSA', 'GOIÂNIA', 'IPORÁ', 'LUZILÂNDIA', 'METROPOLITANA', 'MONTE BELOS', 'MORRINHOS', 'RIO VERDE', 'URUAÇU'],
    'MA': ['CENTRO', 'LESTE', 'NOROESTE', 'NORTE', 'SUL'],
    'PA': ['CENTRO', 'NORDESTE', 'NORTE', 'OESTE', 'SUL'],
    'PI': ['CENTRO-SUL', 'METROPOLITANA', 'NORTE', 'SUL'],
    'RS': ['CAMPANHA', 'CARBONIFERA', 'CENTRO', 'LITORAL NORTE', 'LITORAL SUL', 'METROPOLITANA', 'NORDESTE', 'NORTE', 'PORTO ALEGRE', 'SUL']
    //'PA': ['CENTRO', 'LESTE', 'NORDESTE', 'NOROESTE', 'NORTE', 'OESTE', 'SUL'],
  };

  get distribuidorasKeys() {
    return Object.keys(this.regionalsByState).sort();
  }

  get classesOptions() {
    return Object.keys(this.modelsByClass).sort();
  }

  get currentModelsOptions() {
    if (!this.selectedClasse) return [];
    return this.modelsByClass[this.selectedClasse] || [];
  }

  get currentRelaysOptions() {
    if (this.selectedClasse !== 'RELIGADOR' && this.selectedClasse !== 'REGULADOR' || !this.selectedModelo) return [];
    return this.relaysByRecloserModel[this.selectedModelo] || [];
  }

  @ViewChild('messagesArea') private messagesAreaElement!: ElementRef;
  private shouldScrollToBottom = false;

  ngOnInit() {
    // IMPLEMENTAÇÃO 1: Solicitar permissão ao iniciar
    this.requestNotificationPermission();

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

  // IMPLEMENTAÇÃO 2: Método auxiliar para pedir permissão
  async requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }

  // IMPLEMENTAÇÃO 3: Método para disparar a notificação
  sendBrowserNotification(msg: Message) {
    if (!('Notification' in window)) return;

    if (Notification.permission === 'granted') {
      let bodyText = 'Nova mensagem recebida';
      
      if (msg.text) {
        bodyText = msg.text.length > 50 ? msg.text.substring(0, 50) + '...' : msg.text;
      } else if (msg.mediaType) {
        bodyText = `📷 Mídia recebida (${msg.mediaType})`;
      }

      const notification = new Notification('NOC Atendimentos', {
        body: bodyText,
        icon: 'assets/icons/icon-72x72.png', // Substitua pelo caminho do ícone do seu app
        tag: 'new-message' // Tag para evitar spam de notificações (opcional)
      });

      // Foca na aba ao clicar na notificação
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    }
  }

  private scrollToBottom(): void {
    try {
      this.messagesAreaElement.nativeElement.scrollTop = this.messagesAreaElement.nativeElement.scrollHeight;
    } catch(err) { }
  }

  formatPhone(event: any) {
    let v = event.target.value.replace(/\D/g, "");
    v = v.replace(/^(\d\d)(\d)/g, "($1) $2");
    v = v.replace(/(\d{5})(\d)/, "$1-$2");
    event.target.value = v.substring(0, 15);
  }

  formatAlphaNumeric(event: any) {
    let v = event.target.value;
    v = v.toUpperCase();
    v = v.replace(/[^A-Z0-9- ]/g, ""); 
    v = v.replace(/-{2,}/g, "-"); 
    
    if (v.length > 10) {
      v = v.substring(0, 10);
    }

    event.target.value = v;
  }

  formatMax8AlphaNumeric(event: any) {
    let v = event.target.value;
    v = v.toUpperCase();
    v = v.replace(/[^A-Z0-9- ]/g, "");
    v = v.replace(/-{2,}/g, "-"); 
    
    if (v.length > 8) {
      v = v.substring(0, 8);
    }
    
    event.target.value = v;
  }

  formatIP(event: any) {
    let v = event.target.value;
    v = v.replace(/[^0-9.]/g, "");
    v = v.replace(/\.{2,}/g, ".");
    event.target.value = v;
  }

  formatOnlyNumbers(event: any) {
    let v = event.target.value;
    v = v.replace(/\D/g, "");
    event.target.value = v;
  }

  getFibraIpPlaceholder(tipoFibra: string): string {
    if (!tipoFibra) return 'Digite o IP';

    if (tipoFibra === 'SERIAL') {
      return 'Digite o IP do Switch';
    }

    if (tipoFibra === 'ETHERNET' && this.selectedClasse === 'RELIGADOR') {
      return 'Digite o IP do Relé';
    }

    return 'Digite o IP';
  }

  onOpcaoChange() {
    if (this.selectedOpcao === 'CADASTRO DE PORTA HUGHES') {
      this.selectedModo = 'SATELITAL'; 
      this.selectedTipoSatelital = 'BGAN'; 
    } else {
      this.selectedModo = ''; 
      this.selectedTipoSatelital = '';
    }
  }

  onClasseChange() {
    this.selectedModelo = '';
    this.selectedRele = '';
  }

  onModeloChange() {
    this.selectedRele = '';
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

  async cancelTicket() {
    if (!this.conversationId) return;
    const confirmacao = confirm("Tem certeza que deseja cancelar sua solicitação de atendimento?");
    if (!confirmacao) return;

    try {
      const docRef = doc(this.firestore, 'conversations', this.conversationId);
      await updateDoc(docRef, {
        status: 'closed',
        closedReason: 'canceled_by_user',
        closedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Erro ao cancelar:", error);
      alert("Não foi possível cancelar a solicitação no momento.");
    }
  }

  async submitIntakeForm(form: NgForm) {
    if (form.invalid || !this.userId) return;

    const formData = form.value;
    const ipFinal = formData.ipHidden || formData.ip;
    const portaFinal = formData.portaHidden || formData.porta;

    let modoFinal = formData.modoComunicacao;

    if (formData.modoComunicacao === 'GPRS' && formData.tipoGprs) {
      modoFinal = `GPRS - ${formData.tipoGprs}`;
    } else if (formData.modoComunicacao === 'SATELITAL') {
       const tipoSat = formData.tipoSatelitalHidden || formData.tipoSatelital;
       if (tipoSat) {
         modoFinal = `SATELITAL - ${tipoSat}`;
       }
    } else if (formData.modoComunicacao === 'FIBRA' && formData.tipoFibra) {
      modoFinal = `FIBRA - ${formData.tipoFibra}`;
    }

    if (this.selectedOpcao === 'CADASTRO DE PORTA HUGHES') {
      modoFinal = 'SATELITAL - BGAN';
    }

    const intakeData: IntakeData = {
      nome: formData.nome,
      telefone: formData.telefone,
      distribuidora: formData.distribuidora,
      regional: formData.regional,
      opcaoAtendimento: formData.opcaoAtendimento,
      
      subestacao: formData.subestacao,
      alimentador: formData.alimentador,

      componente: formData.componente,
      classeComponente: formData.classeComponente,
      modelo: formData.modelo,
      rele: formData.rele || null,

      modoComunicacao: modoFinal,
      
      tipoGprs: formData.tipoGprs || null,
      tipoSatelital: formData.tipoSatelital || this.selectedTipoSatelital || null,
      tipoFibra: formData.tipoFibra || null,

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
    
    // Flag para evitar notificações no carregamento inicial do histórico
    let isFirstLoad = true;

    this.messages$ = new Observable((observer) => {
      return onSnapshot(q, (snap) => {
        
        // IMPLEMENTAÇÃO 4: Verificar mudanças e estado da página
        if (!isFirstLoad) {
          snap.docChanges().forEach((change: DocumentChange) => {
            if (change.type === 'added') {
              const msg = change.doc.data() as Message;
              
              // Se a mensagem não é minha E a página está oculta
              if (msg.senderId !== this.userId && document.hidden) {
                this.sendBrowserNotification(msg);
              }
            }
          });
        }

        const msgs = snap.docs.map(d => d.data() as Message);
        observer.next(msgs);
        
        isFirstLoad = false; // Após o primeiro snapshot, habilitamos as notificações
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
    const fileName = (file as File).name || `audio_${Date.now()}.webm`;
    const path = `chat_media/${this.conversationId}/${Date.now()}_${fileName}`;
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

  async downloadMedia(url: string, type: 'image' | 'video' | 'audio' | undefined) {
    if (!url) return;
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      
      let extension = '';
      if (type === 'image') extension = 'jpg';
      else if (type === 'video') extension = 'mp4';
      else if (type === 'audio') extension = 'webm';
      
      const fileName = `arquivo_${new Date().getTime()}.${extension}`;
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);

    } catch (error) {
      console.error('Erro ao baixar mídia:', error);
      window.open(url, '_blank');
    }
  }
}