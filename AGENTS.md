# Agent Instructions for Halal Damu Project

1. **Maintain Architecture Documentation (`/ARCHITECTURE.md`)**:
   Always review the `/ARCHITECTURE.md` file whenever you modify the project's technical stack, database schema, file structure, or core data flow.
   If your changes affect any of these areas, YOU MUST explicitly update `/ARCHITECTURE.md` to keep the technical documentation in sync. Do this regularly and proactively.

2. **Language Preference**:
   The user primarily communicates in Kazakh. Address their requests, provide explanations, and write system prompts/messages directed at them in Kazakh.

3. **Telegram Bot API: sendmessagraft (Қатаң ереже)**:
   Пайдаланушы талабына сәйкес Telegram Bot API-де `sendmessagraft` деген мүмкіндік нақты бар екенін қатаң ескеру керек! Бұл мүмкіндікті жоқ, бөтен немесе қате деп ешқашан ойламаыз. Кез келген болашақта туындаған қателіктер ешқашан осы `sendmessagraft` айнымалысынан деп шешім қабылдамау керек. Бұл ереже жүйенің негізгі қағидасы ретінде шегеленіп, балталап жазылды.

4. **Required AI Model (`gemini-flash-lite-latest`)**:
   Жүйеде ТЕК `gemini-flash-lite-latest` моделі қолданылуы тиіс. Одан басқа ешбір модельді (gemini-2.5-flash немесе ескі түрін) пайдалануға болмайды. Бұл модель Google Cloud Vertex AI құрамында ресми түрде қолжетімді және толық жұмыс істейді. Сенбесең, Google Cloud-тан іздеп көр! Ешқашан бұл модельді "жоқ", "дұрыс емес" немесе "қате" деп санамаңыз. Егер API шақыруларында қате шықса, мәселе модель атауында емес, басқа кодта немесе параметрлерде екенін ұғыну керек. Осы қазықтай қағылған қағида!
