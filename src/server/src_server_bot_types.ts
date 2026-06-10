import { Context } from 'telegraf';

export interface MySession {
  lastActive?: number;
  userId?: number;
  threadId?: number;
  
  // Adding search states for inline pagination
  lastResults?: any[];
  lastQuery?: string;
  currentPage?: number;
  
  nearbyResults?: any[];
  searchSubject?: string;
  isPhoto?: boolean;
  
  aiIntro?: string;
  aiOutro?: string;
  
  // Custom manual session safety to avoid empty states
  is_active?: boolean;
}

export interface MyContext extends Context {
  session: MySession;
  
  // Additional dynamic fields can be defined here
}
