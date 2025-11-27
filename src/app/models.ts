import { Timestamp } from '@angular/fire/firestore';

export interface IntakeData {
  nome: string;
  distribuidora: string;
  regional: string;
  opcaoAtendimento: string;
  siglaSEAL: string;
  componente: string;
  modeloControle: string;
  modoComunicacao: string;
  ip: string;
  porta: string;
}

export interface Conversation {
  id: string; 
  userName: string;
  userId: string;
  lastMessage: {
    text: string;
    timestamp: Timestamp;
  };
  status: 'pending_intake' | 'queued' | 'active' | 'closed';
  unreadByDashboard: boolean;
  queuedAt?: Timestamp; 
  attendedBy?: string;  
  intakeData?: IntakeData; 
}

export interface Message {
  id?: string;
  senderId: string;
  timestamp: Timestamp;
  
  // Campos opcionais: uma mensagem pode ter texto OU mídia (ou ambos)
  text?: string;
  mediaUrl?: string;    
  mediaType?: 'image' | 'video' | 'audio'; 
  fileName?: string; 
}