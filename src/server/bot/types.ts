import { Context } from "telegraf";

export interface MySession {
  lastResults?: any[];
  nearbyResults?: any[];
  searchSubject?: string;
  isPhoto?: boolean;
}

export interface MyContext extends Context {
  session: MySession;
}
