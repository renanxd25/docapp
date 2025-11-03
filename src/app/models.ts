import { Timestamp } from '@angular/fire/firestore';

// NOVA INTERFACE PARA OS DADOS DO FORMULÁRIO
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
  
  // O campo 'intakeData' agora usa a nova interface
  intakeData?: IntakeData; 
}

export interface Message {
  id?: string;
  text: string;
  senderId: string;
  timestamp: Timestamp;
}