import { GoogleGenAI, Type } from "@google/genai";
async function run() {
  const ai = new GoogleGenAI({});
  const chat = ai.chats.create({ model: "model" });
  chat.sendMessage({
    message: [{
      functionResponse: {
        name: "search_halal_companies",
        response: { foo: "bar" }
      }
    }]
  });
}
