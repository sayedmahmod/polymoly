import * as vscode from 'vscode';

export const LANGS = ['de', 'en', 'es', 'fr', 'ar', 'zh'] as const;
export type Lang = (typeof LANGS)[number];

export const LOCALES: Record<Lang, string> = {
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  ar: 'ar-u-nu-latn',
  zh: 'zh-CN'
};

/** Native names for the language picker. */
export const LANGUAGE_NAMES: Record<Lang, string> = {
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  ar: 'العربية',
  zh: '简体中文'
};

type Row = readonly [de: string, en: string, es: string, fr: string, ar: string, zh: string];

/** Every user-visible string of the extension and both webviews. `{name}` marks a placeholder. */
const M: Record<string, Row> = {
  // ---------- common ----------
  'common.loading': ['Lade…', 'Loading…', 'Cargando…', 'Chargement…', 'جارٍ التحميل…', '加载中…'],
  'common.cancel': ['Abbrechen', 'Cancel', 'Cancelar', 'Annuler', 'إلغاء', '取消'],
  'common.close': ['Schließen', 'Close', 'Cerrar', 'Fermer', 'إغلاق', '关闭'],
  'common.save': ['Speichern', 'Save', 'Guardar', 'Enregistrer', 'حفظ', '保存'],
  'common.delete': ['Löschen', 'Delete', 'Eliminar', 'Supprimer', 'حذف', '删除'],
  'common.remove': ['Entfernen', 'Remove', 'Quitar', 'Retirer', 'إزالة', '移除'],
  'common.add': ['Hinzufügen', 'Add', 'Añadir', 'Ajouter', 'إضافة', '添加'],
  'common.edit': ['Bearbeiten', 'Edit', 'Editar', 'Modifier', 'تعديل', '编辑'],
  'common.create': ['Anlegen', 'Create', 'Crear', 'Créer', 'إنشاء', '创建'],
  'common.untitled': ['Unbenannt', 'Untitled', 'Sin título', 'Sans titre', 'بلا عنوان', '未命名'],
  'common.eg': ['z. B. {value}', 'e.g. {value}', 'p. ej. {value}', 'p. ex. {value}', 'مثلًا {value}', '例如 {value}'],

  // ---------- header & composer ----------
  'header.history': ['Verlauf', 'History', 'Historial', 'Historique', 'السجل', '历史记录'],
  'header.newChat': ['Neuer Chat', 'New chat', 'Nuevo chat', 'Nouveau chat', 'محادثة جديدة', '新对话'],
  'composer.placeholder': ['Nachricht an {name}…', 'Message {name}…', 'Mensaje para {name}…', 'Message à {name}…', 'رسالة إلى {name}…', '给 {name} 发消息…'],
  'composer.attach': ['Datei anhängen', 'Attach file', 'Adjuntar archivo', 'Joindre un fichier', 'إرفاق ملف', '附加文件'],
  'composer.actions': ['Aktionen', 'Actions', 'Acciones', 'Actions', 'الإجراءات', '操作'],
  'composer.send': ['Senden', 'Send', 'Enviar', 'Envoyer', 'إرسال', '发送'],
  'composer.stop': ['Abbrechen', 'Stop', 'Detener', 'Arrêter', 'إيقاف', '停止'],
  'model.choose': ['Modell wählen', 'Choose model', 'Elegir modelo', 'Choisir un modèle', 'اختر نموذجًا', '选择模型'],
  'model.menuTitle': ['Modell auswählen', 'Select a model', 'Selecciona un modelo', 'Sélectionner un modèle', 'اختر نموذجًا', '选择一个模型'],
  'model.noneActive': ['Keine Modelle aktiv. Einstellungen öffnen.', 'No models enabled. Open the settings.', 'No hay modelos activos. Abre la configuración.', 'Aucun modèle actif. Ouvrez les paramètres.', 'لا توجد نماذج مفعّلة. افتح الإعدادات.', '没有启用的模型。请打开设置。'],
  'drop.tooBig': ['{name} ist größer als 30 MB und wird nicht angehängt.', '{name} is larger than 30 MB and will not be attached.', '{name} supera los 30 MB y no se adjuntará.', '{name} dépasse 30 Mo et ne sera pas joint.', '‏{name} أكبر من 30 ميغابايت ولن يُرفق.', '{name} 超过 30 MB，不会被附加。'],

  // ---------- effort ----------
  'effort.minimal': ['Minimal', 'Minimal', 'Mínimo', 'Minimal', 'أدنى', '最低'],
  'effort.low': ['Niedrig', 'Low', 'Bajo', 'Faible', 'منخفض', '低'],
  'effort.medium': ['Mittel', 'Medium', 'Medio', 'Moyen', 'متوسط', '中'],
  'effort.high': ['Hoch', 'High', 'Alto', 'Élevé', 'مرتفع', '高'],
  'effort.xhigh': ['Sehr hoch', 'Extra high', 'Muy alto', 'Très élevé', 'مرتفع جدًا', '很高'],
  'effort.max': ['Max', 'Max', 'Máx.', 'Max', 'أقصى', '最高'],
  'effort.ultra': ['Ultra', 'Ultra', 'Ultra', 'Ultra', 'فائق', '极致'],

  // ---------- palette ----------
  'group.context': ['Kontext', 'Context', 'Contexto', 'Contexte', 'السياق', '上下文'],
  'group.model': ['Modell', 'Model', 'Modelo', 'Modèle', 'النموذج', '模型'],
  'group.customize': ['Anpassen', 'Customize', 'Personalizar', 'Personnaliser', 'تخصيص', '自定义'],
  'group.settings': ['Einstellungen', 'Settings', 'Configuración', 'Paramètres', 'الإعدادات', '设置'],
  'group.skills': ['Skills', 'Skills', 'Skills', 'Skills', 'المهارات', '技能'],
  'group.options': ['Optionen', 'Options', 'Opciones', 'Options', 'خيارات', '选项'],
  'palette.attach': ['Datei anhängen…', 'Attach file…', 'Adjuntar archivo…', 'Joindre un fichier…', 'إرفاق ملف…', '附加文件…'],
  'palette.mention': ['Datei aus diesem Projekt erwähnen…', 'Mention file from this project…', 'Mencionar archivo de este proyecto…', 'Mentionner un fichier du projet…', 'الإشارة إلى ملف من هذا المشروع…', '引用本项目中的文件…'],
  'palette.clear': ['Unterhaltung leeren', 'Clear conversation', 'Vaciar conversación', 'Effacer la conversation', 'مسح المحادثة', '清空对话'],
  'palette.rewind': ['Zurückspulen', 'Rewind', 'Rebobinar', 'Revenir en arrière', 'الرجوع للخلف', '回退'],
  'palette.switchModel': ['Modell wechseln…', 'Switch model…', 'Cambiar modelo…', 'Changer de modèle…', 'تبديل النموذج…', '切换模型…'],
  'palette.effort': ['Aufwand', 'Effort', 'Esfuerzo', 'Effort', 'الجهد', '推理强度'],
  'palette.thinking': ['Denken', 'Thinking', 'Razonamiento', 'Réflexion', 'التفكير', '思考'],
  'palette.showTools': ['Tool-Aufrufe zeigen', 'Show tool calls', 'Mostrar llamadas a herramientas', 'Afficher les appels d’outils', 'إظهار استدعاءات الأدوات', '显示工具调用'],
  'palette.mcp': ['MCP-Server', 'MCP servers', 'Servidores MCP', 'Serveurs MCP', 'خوادم MCP', 'MCP 服务器'],
  'palette.skills': ['Skills', 'Skills', 'Skills', 'Skills', 'المهارات', '技能'],
  'palette.providers': ['Provider & Modelle', 'Providers & models', 'Proveedores y modelos', 'Fournisseurs et modèles', 'المزوّدون والنماذج', '提供商与模型'],
  'palette.general': ['Allgemeine Einstellungen…', 'General settings…', 'Configuración general…', 'Paramètres généraux…', 'الإعدادات العامة…', '常规设置…'],
  'palette.usage': ['Accounts & Nutzung…', 'Accounts & usage…', 'Cuentas y uso…', 'Comptes et utilisation…', 'الحسابات والاستخدام…', '账户与用量…'],
  'palette.check': ['Provider-Status prüfen', 'Check provider status', 'Comprobar estado de proveedores', 'Vérifier l’état des fournisseurs', 'فحص حالة المزوّدين', '检查提供商状态'],
  'palette.settingsJson': ['settings.json öffnen', 'Open settings.json', 'Abrir settings.json', 'Ouvrir settings.json', 'فتح settings.json', '打开 settings.json'],
  'palette.filter': ['Aktionen filtern…', 'Filter actions…', 'Filtrar acciones…', 'Filtrer les actions…', 'تصفية الإجراءات…', '筛选操作…'],
  'palette.noMatch': ['Kein Treffer', 'No match', 'Sin resultados', 'Aucun résultat', 'لا نتائج', '无匹配项'],

  // ---------- transcript ----------
  'step.thinking': ['Denkprozess', 'Thinking', 'Razonamiento', 'Réflexion', 'التفكير', '思考过程'],
  'msg.notSent': ['nicht gesendet', 'not sent', 'no enviado', 'non envoyé', 'لم يُرسل', '未发送'],
  'spinner.words': ['', 'Thinking|Working|Juggling models|Connecting dots|Reading code|Wiring things up|Polishing|Untangling|Sketching|Checking', 'Pensando|Trabajando|Malabareando modelos|Uniendo piezas|Leyendo código|Conectando cosas|Puliendo|Desenredando|Esbozando|Revisando', 'Réflexion|Travail en cours|Jonglage de modèles|Assemblage|Lecture du code|Branchements|Peaufinage|Démêlage|Esquisse|Vérification', 'يفكّر|يعمل|يوازن بين النماذج|يربط الأفكار|يقرأ الشيفرة|يوصل الأجزاء|يصقل|يفكّ التشابك|يرسم مسودة|يتحقق', '思考中|处理中|调度模型|串联线索|阅读代码|连接组件|打磨中|理清思路|起草中|检查中'],

  // ---------- usage limits under the composer ----------
  'limit.used': ['{percent} % verbraucht', '{percent}% used', '{percent} % usado', '{percent} % utilisé', 'استُهلك {percent}%', '已用 {percent}%'],
  'limit.thisWeek': ['diese Woche', 'this week', 'esta semana', 'cette semaine', 'هذا الأسبوع', '本周'],
  'limit.resets': ['Reset {time}', 'resets {time}', 'se reinicia {time}', 'réinitialisé {time}', 'يُعاد التعيين {time}', '{time} 重置'],
  'limit.weekly': ['Wochenlimit', 'Weekly limit', 'Límite semanal', 'Limite hebdomadaire', 'الحد الأسبوعي', '每周限额'],
  'limit.session': ['Session-Limit (5 h)', 'Session limit (5 h)', 'Límite de sesión (5 h)', 'Limite de session (5 h)', 'حد الجلسة (5 ساعات)', '会话限额（5 小时）'],

  // ---------- hand-off card ----------
  'handoff.empty': ['<b>{name}</b> ist leer', '<b>{name}</b> is out of quota', '<b>{name}</b> se quedó sin cuota', '<b>{name}</b> n’a plus de quota', 'نفدت حصة <b>{name}</b>', '<b>{name}</b> 额度已用完'],
  'handoff.none': ['Kein anderer Provider verfügbar (ohne Key oder ebenfalls leer).', 'No other provider available (no key or also out of quota).', 'No hay otro proveedor disponible (sin clave o también sin cuota).', 'Aucun autre fournisseur disponible (sans clé ou lui aussi à court de quota).', 'لا يتوفر مزوّد آخر (بلا مفتاح أو نفدت حصته أيضًا).', '没有其他可用的提供商（缺少密钥或额度同样用完）。'],
  'handoff.resumeTokens': ['{name} kennt den Chat bis zu seiner letzten Antwort. Nachgereicht werden {messages} Nachrichten, ≈ {tokens} Tokens.', '{name} knows the chat up to its last answer. {messages} messages (≈ {tokens} tokens) are sent to catch up.', '{name} conoce el chat hasta su última respuesta. Se enviarán {messages} mensajes (≈ {tokens} tokens) para ponerse al día.', '{name} connaît le chat jusqu’à sa dernière réponse. {messages} messages (≈ {tokens} tokens) seront envoyés pour rattraper.', 'يعرف {name} المحادثة حتى آخر رد له. ستُرسل {messages} رسائل (≈ {tokens} رمزًا) لاستكمال السياق.', '{name} 了解到它最后一次回答为止的对话。将补发 {messages} 条消息（≈ {tokens} 个 token）。'],
  'handoff.resumeAll': ['{name} kennt den ganzen Chat, es wird nichts nachgereicht.', '{name} knows the whole chat, nothing needs to be sent.', '{name} conoce todo el chat, no hace falta enviar nada.', '{name} connaît tout le chat, rien à renvoyer.', 'يعرف {name} المحادثة كاملة، لا حاجة لإرسال شيء.', '{name} 了解整个对话，无需补发。'],
  'handoff.omitted': [', {count} ältere gekürzt', ', {count} older ones trimmed', ', {count} anteriores recortados', ', {count} plus anciens tronqués', '، واختُصرت {count} رسائل أقدم', '，已截断 {count} 条较早的消息'],
  'handoff.fits': [' → {tokens} von {window} Kontext', ' → {tokens} of {window} context', ' → {tokens} de {window} de contexto', ' → {tokens} sur {window} de contexte', ' ← {tokens} من سياق {window}', ' → 占 {window} 上下文中的 {tokens}'],
  'handoff.transfer': ['Übergabe: ≈ {tokens} Tokens Transkript ({messages} Nachrichten{omitted}){fits}.', 'Hand-off: ≈ {tokens} tokens of transcript ({messages} messages{omitted}){fits}.', 'Traspaso: ≈ {tokens} tokens de transcripción ({messages} mensajes{omitted}){fits}.', 'Transfert : ≈ {tokens} tokens de transcription ({messages} messages{omitted}){fits}.', 'التسليم: ≈ {tokens} رمزًا من النص ({messages} رسائل{omitted}){fits}.', '交接：≈ {tokens} 个 token 的对话记录（{messages} 条消息{omitted}）{fits}。'],
  'handoff.coldCache': ['Cache kalt: im ersten Turn 0 Cache-Read, alles zählt als frischer Input', 'Cold cache: no cache reads in the first turn, everything counts as fresh input', 'Caché fría: sin lecturas de caché en el primer turno, todo cuenta como entrada nueva', 'Cache froid : aucune lecture de cache au premier tour, tout compte comme nouvelle entrée', 'ذاكرة تخزين باردة: لا قراءات من الذاكرة في الدور الأول، ويُحتسب كل شيء كمدخلات جديدة', '缓存为冷：首轮无缓存读取，全部按新输入计费'],
  'handoff.cliExtra': [', dazu System-Prompt und Tools der CLI', ', plus the CLI’s system prompt and tools', ', más el prompt de sistema y las herramientas de la CLI', ', plus le prompt système et les outils de la CLI', '، إضافة إلى موجّه النظام وأدوات CLI', '，另加 CLI 的系统提示词和工具'],
  'handoff.compare': ['Zum Vergleich {name}, letzter Turn: {input} Input{cache}. Dieser Cache geht verloren.', 'For comparison, {name} last turn: {input} input{cache}. This cache is lost.', 'Para comparar, último turno de {name}: {input} de entrada{cache}. Esta caché se pierde.', 'Pour comparaison, dernier tour de {name} : {input} en entrée{cache}. Ce cache est perdu.', 'للمقارنة، آخر دور لـ {name}: {input} مدخلات{cache}. ستُفقد هذه الذاكرة المؤقتة.', '作为对比，{name} 上一轮：{input} 输入{cache}。这部分缓存将丢失。'],
  'handoff.cacheRead': [' · {count} Cache-Read', ' · {count} cache read', ' · {count} de caché leída', ' · {count} lus depuis le cache', ' · {count} قراءة من الذاكرة المؤقتة', ' · {count} 缓存读取'],
  'handoff.question': ['Weiter mit <b>{name}</b>{effort} <span class="muted">({provider})</span>?', 'Continue with <b>{name}</b>{effort} <span class="muted">({provider})</span>?', '¿Continuar con <b>{name}</b>{effort} <span class="muted">({provider})</span>?', 'Continuer avec <b>{name}</b>{effort} <span class="muted">({provider})</span> ?', 'المتابعة مع <b>{name}</b>{effort} <span class="muted">({provider})</span>؟', '改用 <b>{name}</b>{effort} <span class="muted">（{provider}）</span>继续？'],
  'handoff.accept': ['Ja, weiter', 'Yes, continue', 'Sí, continuar', 'Oui, continuer', 'نعم، تابع', '是，继续'],
  'handoff.other': ['Anderes Modell', 'Other model', 'Otro modelo', 'Autre modèle', 'نموذج آخر', '其他模型'],
  'handoff.no': ['Nein', 'No', 'No', 'Non', 'لا', '否'],
  'handoff.prompt': ['{name} ist mitten in der Aufgabe ausgestiegen ({reason}). Mach genau dort weiter, wo aufgehört wurde, und bring die unterbrochene Aufgabe zu Ende.', '{name} dropped out in the middle of the task ({reason}). Continue exactly where it stopped and finish the interrupted task.', '{name} se detuvo a mitad de la tarea ({reason}). Continúa exactamente donde se quedó y termina la tarea interrumpida.', '{name} s’est arrêté en pleine tâche ({reason}). Reprends exactement là où il s’est arrêté et termine la tâche interrompue.', 'توقّف {name} في منتصف المهمة ({reason}). تابع من النقطة نفسها التي توقف عندها وأكمل المهمة المقطوعة.', '{name} 在任务中途退出了（{reason}）。请从中断的地方继续，完成被打断的任务。'],

  // ---------- history ----------
  'history.today': ['Heute', 'Today', 'Hoy', 'Aujourd’hui', 'اليوم', '今天'],
  'history.yesterday': ['Gestern', 'Yesterday', 'Ayer', 'Hier', 'أمس', '昨天'],
  'history.last7': ['Letzte 7 Tage', 'Last 7 days', 'Últimos 7 días', '7 derniers jours', 'آخر 7 أيام', '最近 7 天'],
  'history.last30': ['Letzte 30 Tage', 'Last 30 days', 'Últimos 30 días', '30 derniers jours', 'آخر 30 يومًا', '最近 30 天'],
  'history.older': ['Älter', 'Older', 'Más antiguos', 'Plus ancien', 'أقدم', '更早'],
  'history.justNow': ['gerade eben', 'just now', 'ahora mismo', 'à l’instant', 'الآن', '刚刚'],
  'history.search': ['Chats durchsuchen…', 'Search chats…', 'Buscar chats…', 'Rechercher des chats…', 'البحث في المحادثات…', '搜索对话…'],
  'history.noMatch': ['Keine Treffer.', 'No matches.', 'Sin resultados.', 'Aucun résultat.', 'لا نتائج.', '没有匹配结果。'],
  'history.empty': ['Noch keine gespeicherten Chats.', 'No saved chats yet.', 'Aún no hay chats guardados.', 'Aucun chat enregistré pour l’instant.', 'لا توجد محادثات محفوظة بعد.', '还没有保存的对话。'],
  'history.messages': ['{count} Nachr.', '{count} msgs', '{count} mens.', '{count} msg', '{count} رسائل', '{count} 条消息'],
  'history.deleteQuestion': ['„{title}“ löschen?', 'Delete “{title}”?', '¿Eliminar «{title}»?', 'Supprimer « {title} » ?', 'حذف «{title}»؟', '删除“{title}”？'],
  'history.deleteDetail': ['Der Chat wird aus dem Verlauf entfernt.', 'The chat will be removed from the history.', 'El chat se eliminará del historial.', 'Le chat sera retiré de l’historique.', 'ستُزال المحادثة من السجل.', '该对话将从历史记录中移除。'],

  // ---------- settings modal ----------
  'settings.title': ['Einstellungen', 'Settings', 'Configuración', 'Paramètres', 'الإعدادات', '设置'],
  'tab.providers': ['Provider & Modelle', 'Providers & models', 'Proveedores y modelos', 'Fournisseurs et modèles', 'المزوّدون والنماذج', '提供商与模型'],
  'tab.mcp': ['MCP-Server', 'MCP servers', 'Servidores MCP', 'Serveurs MCP', 'خوادم MCP', 'MCP 服务器'],
  'tab.skills': ['Skills', 'Skills', 'Skills', 'Skills', 'المهارات', '技能'],
  'tab.general': ['Allgemein', 'General', 'General', 'Général', 'عام', '常规'],

  'providers.intro': ['Provider an- und ausschalten, Verbindung (CLI oder API-Key) einrichten und Modelle für das Modell-Menü wählen.', 'Turn providers on and off, set up the connection (CLI or API key) and choose the models for the model menu.', 'Activa o desactiva proveedores, configura la conexión (CLI o clave API) y elige los modelos del menú de modelos.', 'Activez ou désactivez les fournisseurs, configurez la connexion (CLI ou clé API) et choisissez les modèles du menu.', 'فعّل المزوّدين أو عطّلهم، واضبط الاتصال (CLI أو مفتاح API)، واختر النماذج التي تظهر في قائمة النماذج.', '启用或停用提供商，设置连接方式（CLI 或 API 密钥），并选择模型菜单中显示的模型。'],
  'providers.newTitle': ['Neuer Provider (OpenAI- oder Anthropic-kompatible API)', 'New provider (OpenAI- or Anthropic-compatible API)', 'Nuevo proveedor (API compatible con OpenAI o Anthropic)', 'Nouveau fournisseur (API compatible OpenAI ou Anthropic)', 'مزوّد جديد (واجهة API متوافقة مع OpenAI أو Anthropic)', '新提供商（兼容 OpenAI 或 Anthropic 的 API）'],
  'providers.add': ['+ Provider hinzufügen', '+ Add provider', '+ Añadir proveedor', '+ Ajouter un fournisseur', '+ إضافة مزوّد', '+ 添加提供商'],
  'field.id': ['ID', 'ID', 'ID', 'ID', 'المعرّف', 'ID'],
  'field.name': ['Name', 'Name', 'Nombre', 'Nom', 'الاسم', '名称'],
  'field.baseUrl': ['Base-URL', 'Base URL', 'URL base', 'URL de base', 'عنوان URL الأساسي', '基础 URL'],
  'field.apiFormat': ['API-Format', 'API format', 'Formato de API', 'Format d’API', 'صيغة API', 'API 格式'],
  'field.models': ['Modelle', 'Models', 'Modelos', 'Modèles', 'النماذج', '模型'],
  'field.apiKey': ['API-Key', 'API key', 'Clave API', 'Clé API', 'مفتاح API', 'API 密钥'],
  'field.modelsHint': ['Kommagetrennte Modell-IDs.', 'Comma-separated model IDs.', 'IDs de modelo separados por comas.', 'Identifiants de modèles séparés par des virgules.', 'معرّفات النماذج مفصولة بفواصل.', '以逗号分隔的模型 ID。'],
  'field.modelsPlaceholder': ['modell-a, modell-b', 'model-a, model-b', 'modelo-a, modelo-b', 'modele-a, modele-b', 'model-a, model-b', 'model-a, model-b'],
  'field.cliCommand': ['CLI-Befehl', 'CLI command', 'Comando CLI', 'Commande CLI', 'أمر CLI', 'CLI 命令'],
  'field.cliHint': ['Name oder absoluter Pfad. Login und Abo laufen über die CLI selbst.', 'Name or absolute path. Login and subscription are handled by the CLI itself.', 'Nombre o ruta absoluta. El inicio de sesión y la suscripción los gestiona la propia CLI.', 'Nom ou chemin absolu. La connexion et l’abonnement sont gérés par la CLI elle-même.', 'الاسم أو المسار الكامل. تتولى أداة CLI نفسها تسجيل الدخول والاشتراك.', '名称或绝对路径。登录和订阅由 CLI 自行处理。'],
  'key.saved': ['•••••••• gespeichert', '•••••••• saved', '•••••••• guardada', '•••••••• enregistrée', '•••••••• محفوظ', '•••••••• 已保存'],
  'key.unset': ['nicht gesetzt', 'not set', 'sin definir', 'non définie', 'غير مضبوط', '未设置'],
  'field.adminKey': ['Usage-Admin-Key (optional)', 'Usage admin key (optional)', 'Clave de administración de uso (opcional)', 'Clé admin d’utilisation (facultative)', 'مفتاح إدارة الاستخدام (اختياري)', '用量管理密钥（可选）'],
  'field.adminHint': ['Org-Key für die Ansicht „Accounts & Nutzung“.', 'Organization key for the “Accounts & usage” view.', 'Clave de organización para la vista «Cuentas y uso».', 'Clé d’organisation pour la vue « Comptes et utilisation ».', 'مفتاح المؤسسة لعرض «الحسابات والاستخدام».', '用于“账户与用量”视图的组织密钥。'],
  'providers.check': ['Verbindung prüfen', 'Test connection', 'Probar conexión', 'Tester la connexion', 'اختبار الاتصال', '测试连接'],
  'providers.fetchModels': ['Modelle abrufen', 'Fetch models', 'Obtener modelos', 'Récupérer les modèles', 'جلب النماذج', '获取模型'],
  'providers.allOn': ['Alle an', 'All on', 'Todos activos', 'Tout activer', 'تفعيل الكل', '全部启用'],
  'providers.allOff': ['Alle aus', 'All off', 'Todos inactivos', 'Tout désactiver', 'تعطيل الكل', '全部停用'],
  'providers.filterModels': ['Modelle filtern…', 'Filter models…', 'Filtrar modelos…', 'Filtrer les modèles…', 'تصفية النماذج…', '筛选模型…'],
  'providers.noModels': ['Keine Modelle.', 'No models.', 'Sin modelos.', 'Aucun modèle.', 'لا توجد نماذج.', '没有模型。'],
  'providers.moreModel': ['Weitere Modell-ID', 'Another model ID', 'Otro ID de modelo', 'Autre identifiant de modèle', 'معرّف نموذج آخر', '其他模型 ID'],
  'providers.reset': ['Auf Standard zurücksetzen', 'Reset to default', 'Restablecer valores predeterminados', 'Rétablir les valeurs par défaut', 'إعادة إلى الافتراضي', '恢复默认'],
  'providers.remove': ['Provider löschen', 'Delete provider', 'Eliminar proveedor', 'Supprimer le fournisseur', 'حذف المزوّد', '删除提供商'],
  'providers.activeCount': ['{on}/{total} Modelle aktiv', '{on}/{total} models enabled', '{on}/{total} modelos activos', '{on}/{total} modèles actifs', '{on}/{total} نماذج مفعّلة', '已启用 {on}/{total} 个模型'],
  'providers.checking': ['prüfe…', 'checking…', 'comprobando…', 'vérification…', 'جارٍ الفحص…', '检查中…'],
  'providers.fetching': ['rufe Modelle ab…', 'fetching models…', 'obteniendo modelos…', 'récupération des modèles…', 'جارٍ جلب النماذج…', '正在获取模型…'],

  'mcp.intro': ['Diese Server teilen sich alle CLI-Provider: Claude Code bekommt sie per <code>--mcp-config</code>, Codex per <code>-c mcp_servers.*</code>. HTTP-Provider führen keine Tools aus.', 'All CLI providers share these servers: Claude Code gets them via <code>--mcp-config</code>, Codex via <code>-c mcp_servers.*</code>. HTTP providers do not run tools.', 'Todos los proveedores CLI comparten estos servidores: Claude Code los recibe con <code>--mcp-config</code> y Codex con <code>-c mcp_servers.*</code>. Los proveedores HTTP no ejecutan herramientas.', 'Tous les fournisseurs CLI partagent ces serveurs : Claude Code les reçoit via <code>--mcp-config</code>, Codex via <code>-c mcp_servers.*</code>. Les fournisseurs HTTP n’exécutent pas d’outils.', 'تتشارك جميع مزوّدات CLI هذه الخوادم: يحصل عليها Claude Code عبر <code>--mcp-config</code>، وCodex عبر <code>-c mcp_servers.*</code>. مزوّدات HTTP لا تنفّذ أدوات.', '所有 CLI 提供商共享这些服务器：Claude Code 通过 <code>--mcp-config</code> 获取，Codex 通过 <code>-c mcp_servers.*</code> 获取。HTTP 提供商不执行工具。'],
  'mcp.none': ['Noch keine MCP-Server.', 'No MCP servers yet.', 'Aún no hay servidores MCP.', 'Aucun serveur MCP pour l’instant.', 'لا توجد خوادم MCP بعد.', '还没有 MCP 服务器。'],
  'mcp.add': ['+ MCP-Server hinzufügen', '+ Add MCP server', '+ Añadir servidor MCP', '+ Ajouter un serveur MCP', '+ إضافة خادم MCP', '+ 添加 MCP 服务器'],
  'mcp.editTitle': ['MCP-Server bearbeiten', 'Edit MCP server', 'Editar servidor MCP', 'Modifier le serveur MCP', 'تعديل خادم MCP', '编辑 MCP 服务器'],
  'mcp.newTitle': ['Neuer MCP-Server', 'New MCP server', 'Nuevo servidor MCP', 'Nouveau serveur MCP', 'خادم MCP جديد', '新建 MCP 服务器'],
  'mcp.type': ['Typ', 'Type', 'Tipo', 'Type', 'النوع', '类型'],
  'mcp.stdio': ['stdio (lokaler Prozess)', 'stdio (local process)', 'stdio (proceso local)', 'stdio (processus local)', 'stdio (عملية محلية)', 'stdio（本地进程）'],
  'mcp.command': ['Befehl', 'Command', 'Comando', 'Commande', 'الأمر', '命令'],
  'mcp.args': ['Argumente', 'Arguments', 'Argumentos', 'Arguments', 'الوسائط', '参数'],
  'mcp.argsHint': ['Ein Argument pro Zeile.', 'One argument per line.', 'Un argumento por línea.', 'Un argument par ligne.', 'وسيط واحد في كل سطر.', '每行一个参数。'],
  'mcp.env': ['Umgebung', 'Environment', 'Entorno', 'Environnement', 'متغيرات البيئة', '环境变量'],
  'mcp.envHint': ['KEY=VALUE, eine Zeile pro Variable.', 'KEY=VALUE, one line per variable.', 'KEY=VALUE, una línea por variable.', 'KEY=VALUE, une ligne par variable.', 'KEY=VALUE، سطر لكل متغير.', 'KEY=VALUE，每行一个变量。'],
  'mcp.headers': ['Header', 'Headers', 'Cabeceras', 'En-têtes', 'الترويسات', '请求头'],
  'mcp.headersHint': ['Name: Wert, eine Zeile pro Header.', 'Name: value, one line per header.', 'Nombre: valor, una línea por cabecera.', 'Nom : valeur, une ligne par en-tête.', 'الاسم: القيمة، سطر لكل ترويسة.', '名称: 值，每行一个请求头。'],

  'skills.intro': ['Skills im <code>SKILL.md</code>-Format (Claude, Codex/GPT) liegen in einem gemeinsamen Ordner und gelten für alle Provider. Claude Code und Codex bekommen die Liste und lesen einen Skill selbst, wenn er passt. Mit <code>/name</code> am Anfang einer Nachricht lädt jedes Modell den Skill direkt, auch API-Provider.', 'Skills in <code>SKILL.md</code> format (Claude, Codex/GPT) live in one shared folder and apply to every provider. Claude Code and Codex get the list and read a skill themselves when it fits. Starting a message with <code>/name</code> loads the skill directly for any model, API providers included.', 'Las skills en formato <code>SKILL.md</code> (Claude, Codex/GPT) están en una carpeta compartida y sirven para todos los proveedores. Claude Code y Codex reciben la lista y leen una skill cuando encaja. Si empiezas un mensaje con <code>/nombre</code>, cualquier modelo carga la skill directamente, también los proveedores API.', 'Les skills au format <code>SKILL.md</code> (Claude, Codex/GPT) sont rangées dans un dossier commun et valent pour tous les fournisseurs. Claude Code et Codex reçoivent la liste et lisent une skill d’eux-mêmes quand elle convient. Commencer un message par <code>/nom</code> charge la skill directement pour n’importe quel modèle, y compris les fournisseurs API.', 'تُحفظ المهارات بصيغة <code>SKILL.md</code> ‏(Claude وCodex/GPT) في مجلد مشترك وتنطبق على جميع المزوّدين. يتلقى Claude Code وCodex القائمة ويقرآن المهارة بنفسيهما عند الحاجة. بدء الرسالة بـ <code>/name</code> يحمّل المهارة مباشرةً لأي نموذج، بما في ذلك مزوّدات API.', '<code>SKILL.md</code> 格式的技能（Claude、Codex/GPT）存放在一个共享文件夹中，对所有提供商生效。Claude Code 和 Codex 会拿到技能列表，并在合适时自行读取。在消息开头写 <code>/名称</code>，任何模型（包括 API 提供商）都会直接加载该技能。'],
  'skills.installFrom': ['Installieren aus', 'Install from', 'Instalar desde', 'Installer depuis', 'التثبيت من', '安装来源'],
  'skills.sourcePlaceholder': ['https://github.com/anthropics/skills/tree/main/skills/pdf  ·  Pfad  ·  .zip/.skill', 'https://github.com/anthropics/skills/tree/main/skills/pdf  ·  path  ·  .zip/.skill', 'https://github.com/anthropics/skills/tree/main/skills/pdf  ·  ruta  ·  .zip/.skill', 'https://github.com/anthropics/skills/tree/main/skills/pdf  ·  chemin  ·  .zip/.skill', 'https://github.com/anthropics/skills/tree/main/skills/pdf  ·  مسار  ·  .zip/.skill', 'https://github.com/anthropics/skills/tree/main/skills/pdf  ·  路径  ·  .zip/.skill'],
  'skills.sourceHint': ['GitHub-Link (Repo oder Unterordner), Git-URL, URL zu SKILL.md oder ZIP, lokaler Ordner oder Datei. Ein Repo mit mehreren Skills installiert alle.', 'GitHub link (repo or subfolder), Git URL, URL to a SKILL.md or ZIP, local folder or file. A repo with several skills installs all of them.', 'Enlace de GitHub (repositorio o subcarpeta), URL de Git, URL a un SKILL.md o ZIP, carpeta o archivo local. Un repositorio con varias skills las instala todas.', 'Lien GitHub (dépôt ou sous-dossier), URL Git, URL vers un SKILL.md ou un ZIP, dossier ou fichier local. Un dépôt contenant plusieurs skills les installe toutes.', 'رابط GitHub (مستودع أو مجلد فرعي)، أو عنوان Git، أو رابط إلى SKILL.md أو ZIP، أو مجلد أو ملف محلي. المستودع الذي يحوي عدة مهارات يثبّتها جميعًا.', 'GitHub 链接（仓库或子文件夹）、Git URL、指向 SKILL.md 或 ZIP 的 URL、本地文件夹或文件。包含多个技能的仓库会全部安装。'],
  'skills.install': ['Installieren', 'Install', 'Instalar', 'Installer', 'تثبيت', '安装'],
  'skills.pick': ['Datei/Ordner wählen…', 'Choose file/folder…', 'Elegir archivo/carpeta…', 'Choisir un fichier/dossier…', 'اختر ملفًا/مجلدًا…', '选择文件/文件夹…'],
  'skills.openFolder': ['Skill-Ordner öffnen', 'Open skills folder', 'Abrir carpeta de skills', 'Ouvrir le dossier des skills', 'فتح مجلد المهارات', '打开技能文件夹'],
  'skills.folder': ['Ordner', 'Folder', 'Carpeta', 'Dossier', 'المجلد', '文件夹'],
  'skills.noDescription': ['Keine Beschreibung.', 'No description.', 'Sin descripción.', 'Aucune description.', 'لا يوجد وصف.', '无描述。'],
  'skills.foundOne': ['1 Skill aus anderen Tools gefunden', '1 skill found in other tools', '1 skill encontrada en otras herramientas', '1 skill trouvée dans d’autres outils', 'عُثر على مهارة واحدة في أدوات أخرى', '在其他工具中发现 1 个技能'],
  'skills.foundMany': ['{count} Skills aus anderen Tools gefunden', '{count} skills found in other tools', '{count} skills encontradas en otras herramientas', '{count} skills trouvées dans d’autres outils', 'عُثر على {count} مهارات في أدوات أخرى', '在其他工具中发现 {count} 个技能'],
  'skills.importAll': ['Alle übernehmen', 'Import all', 'Importar todas', 'Tout importer', 'استيراد الكل', '全部导入'],
  'skills.none': ['Noch keine Skills installiert.', 'No skills installed yet.', 'Aún no hay skills instaladas.', 'Aucune skill installée pour l’instant.', 'لم تُثبّت أي مهارات بعد.', '还没有安装技能。'],
  'skills.installing': ['installiere…', 'installing…', 'instalando…', 'installation…', 'جارٍ التثبيت…', '安装中…'],
  'skills.installed': ['Installiert: {names}', 'Installed: {names}', 'Instalado: {names}', 'Installé : {names}', 'تم التثبيت: {names}', '已安装：{names}'],
  'skills.nothingNew': ['Nichts Neues gefunden.', 'Nothing new found.', 'No se encontró nada nuevo.', 'Rien de nouveau trouvé.', 'لم يُعثر على جديد.', '没有发现新内容。'],
  'skills.deleteQuestion': ['Skill „{name}“ löschen? Der Ordner wird entfernt.', 'Delete skill “{name}”? Its folder will be removed.', '¿Eliminar la skill «{name}»? Se borrará su carpeta.', 'Supprimer la skill « {name} » ? Son dossier sera supprimé.', 'حذف المهارة «{name}»؟ سيُزال مجلدها.', '删除技能“{name}”？其文件夹将被移除。'],
  'skill.applySkill': ['Wende den Skill "{name}" an.', 'Apply the skill "{name}".', 'Aplicar la habilidad "{name}".', 'Appliquer la compétence "{name}".', 'تطبيق المهارة "{name}".', '应用技能“{name}”。'],
  'skills.dialogInstall': ['Skill installieren', 'Install skill', 'Instalar skill', 'Installer la skill', 'تثبيت المهارة', '安装技能'],
  'skills.allFiles': ['Alle Dateien', 'All files', 'Todos los archivos', 'Tous les fichiers', 'كل الملفات', '所有文件'],

  'general.defaultProvider': ['Standard-Provider für neue Chats', 'Default provider for new chats', 'Proveedor predeterminado para chats nuevos', 'Fournisseur par défaut des nouveaux chats', 'المزوّد الافتراضي للمحادثات الجديدة', '新对话的默认提供商'],
  'general.language': ['Sprache', 'Language', 'Idioma', 'Langue', 'اللغة', '语言'],
  'general.languageAuto': ['Automatisch (VS-Code-Sprache)', 'Automatic (VS Code language)', 'Automático (idioma de VS Code)', 'Automatique (langue de VS Code)', 'تلقائي (لغة VS Code)', '自动（跟随 VS Code 语言）'],
  'general.claudePermission': ['Claude Code: Permission-Mode', 'Claude Code: permission mode', 'Claude Code: modo de permisos', 'Claude Code : mode d’autorisation', 'Claude Code: وضع الأذونات', 'Claude Code：权限模式'],
  'general.permDefault': ['blockiert im Headless-Betrieb die meisten Tools', 'blocks most tools when running headless', 'bloquea la mayoría de herramientas sin interfaz', 'bloque la plupart des outils en mode headless', 'يحظر معظم الأدوات في الوضع دون واجهة', '无界面运行时会阻止大多数工具'],
  'general.permAcceptEdits': ['Dateiänderungen ohne Rückfrage', 'file edits without asking', 'edita archivos sin preguntar', 'modifie les fichiers sans demander', 'تعديل الملفات دون سؤال', '无需确认即可修改文件'],
  'general.permBypass': ['auch Shell ohne Rückfrage', 'shell commands too, without asking', 'también comandos de shell sin preguntar', 'aussi les commandes shell sans demander', 'وأوامر الطرفية أيضًا دون سؤال', '连 shell 命令也无需确认'],
  'general.permPlan': ['nur planen', 'plan only', 'solo planificar', 'planifier uniquement', 'التخطيط فقط', '仅规划'],
  'general.codexSandbox': ['Codex: Sandbox', 'Codex: sandbox', 'Codex: sandbox', 'Codex : sandbox', 'Codex: بيئة معزولة', 'Codex：沙箱'],

  // ---------- usage panel ----------
  'usage.title': ['Accounts & Nutzung', 'Accounts & usage', 'Cuentas y uso', 'Comptes et utilisation', 'الحسابات والاستخدام', '账户与用量'],
  'usage.configure': ['Provider konfigurieren', 'Configure providers', 'Configurar proveedores', 'Configurer les fournisseurs', 'إعداد المزوّدين', '配置提供商'],
  'usage.refresh': ['Aktualisieren', 'Refresh', 'Actualizar', 'Actualiser', 'تحديث', '刷新'],
  'usage.source': ['Quelle: Usage-APIs der Provider', 'Source: the providers’ usage APIs', 'Fuente: las API de uso de los proveedores', 'Source : les API d’utilisation des fournisseurs', 'المصدر: واجهات API للاستخدام لدى المزوّدين', '来源：各提供商的用量 API'],
  'usage.totalCost': ['Kosten gesamt', 'Total cost', 'Coste total', 'Coût total', 'التكلفة الإجمالية', '总费用'],
  'usage.inputTokens': ['Input-Tokens', 'Input tokens', 'Tokens de entrada', 'Tokens en entrée', 'رموز الإدخال', '输入 token'],
  'usage.outputTokens': ['Output-Tokens', 'Output tokens', 'Tokens de salida', 'Tokens en sortie', 'رموز الإخراج', '输出 token'],
  'usage.cacheTokens': ['Cache-Tokens', 'Cache tokens', 'Tokens de caché', 'Tokens de cache', 'رموز الذاكرة المؤقتة', '缓存 token'],
  'usage.requests': ['Requests', 'Requests', 'Solicitudes', 'Requêtes', 'الطلبات', '请求数'],
  'usage.cost': ['Kosten', 'Cost', 'Coste', 'Coût', 'التكلفة', '费用'],
  'usage.input': ['Input', 'Input', 'Entrada', 'Entrée', 'الإدخال', '输入'],
  'usage.output': ['Output', 'Output', 'Salida', 'Sortie', 'الإخراج', '输出'],
  'usage.cacheRead': ['Cache read', 'Cache read', 'Caché leída', 'Cache lu', 'قراءة الذاكرة المؤقتة', '缓存读取'],
  'usage.cacheWrite': ['Cache write', 'Cache write', 'Caché escrita', 'Cache écrit', 'كتابة الذاكرة المؤقتة', '缓存写入'],
  'usage.balance': ['Guthaben', 'Balance', 'Saldo', 'Solde', 'الرصيد', '余额'],
  'usage.model': ['Modell', 'Model', 'Modelo', 'Modèle', 'النموذج', '模型'],
  'usage.setAdminKey': ['Admin-Key setzen', 'Set admin key', 'Definir clave de administración', 'Définir la clé admin', 'ضبط مفتاح الإدارة', '设置管理密钥'],
  'usage.barTitle': ['{date}: {tokens} Tokens, {cost}', '{date}: {tokens} tokens, {cost}', '{date}: {tokens} tokens, {cost}', '{date} : {tokens} tokens, {cost}', '{date}: {tokens} رمزًا، {cost}', '{date}：{tokens} token，{cost}'],
  'usage.window5h': ['5-Stunden-Fenster', '5-hour window', 'Ventana de 5 horas', 'Fenêtre de 5 heures', 'نافذة 5 ساعات', '5 小时窗口'],
  'usage.window7d': ['7-Tage-Fenster', '7-day window', 'Ventana de 7 días', 'Fenêtre de 7 jours', 'نافذة 7 أيام', '7 天窗口'],
  'usage.subscription': ['Abo-Auslastung', 'Subscription usage', 'Uso de la suscripción', 'Utilisation de l’abonnement', 'استخدام الاشتراك', '订阅用量'],
  'usage.overage': [' · Overage aktiv', ' · overage active', ' · exceso activo', ' · dépassement actif', ' · تجاوز الحد مفعّل', ' · 超额计费已启用'],
  'usage.asOf': ['Stand {time}', 'as of {time}', 'a fecha de {time}', 'au {time}', 'حتى {time}', '截至 {time}'],
  'usage.reset': ['Reset {time}', 'resets {time}', 'se reinicia {time}', 'réinitialisé {time}', 'يُعاد التعيين {time}', '{time} 重置'],
  'usage.noUsageApi': ['Keine Usage-API konfiguriert. `usage` im Provider-Eintrag setzen.', 'No usage API configured. Set `usage` in the provider entry.', 'No hay API de uso configurada. Define `usage` en la entrada del proveedor.', 'Aucune API d’utilisation configurée. Définissez `usage` dans l’entrée du fournisseur.', 'لم تُضبط واجهة API للاستخدام. اضبط `usage` في إدخال المزوّد.', '未配置用量 API。请在提供商条目中设置 `usage`。'],
  'usage.noAdminKey': ['Kein Admin-Key gespeichert (PolyMoly: Usage-Admin-Key für Provider setzen).', 'No admin key saved (PolyMoly: Set usage admin key for provider).', 'No hay clave de administración guardada (PolyMoly: Definir clave de administración de uso).', 'Aucune clé admin enregistrée (PolyMoly : Définir la clé admin d’utilisation).', 'لا يوجد مفتاح إدارة محفوظ (PolyMoly: ضبط مفتاح إدارة الاستخدام للمزوّد).', '未保存管理密钥（PolyMoly：为提供商设置用量管理密钥）。'],
  'usage.anthropicHint': ['Zeigt API-Verbrauch der Organisation. Abo-Nutzung der claude-CLI ist hier nicht enthalten.', 'Shows the organization’s API usage. Subscription usage of the claude CLI is not included.', 'Muestra el uso de API de la organización. No incluye el uso de la suscripción de la CLI claude.', 'Affiche l’utilisation API de l’organisation. L’utilisation d’abonnement de la CLI claude n’est pas incluse.', 'يعرض استخدام API للمؤسسة. لا يشمل استخدام الاشتراك عبر claude CLI.', '显示组织的 API 用量，不包含 claude CLI 的订阅用量。'],
  'usage.openaiHint': ['Zeigt API-Verbrauch der Organisation. ChatGPT-Abo-Nutzung von Codex ist hier nicht enthalten.', 'Shows the organization’s API usage. ChatGPT subscription usage from Codex is not included.', 'Muestra el uso de API de la organización. No incluye el uso de la suscripción de ChatGPT desde Codex.', 'Affiche l’utilisation API de l’organisation. L’utilisation de l’abonnement ChatGPT via Codex n’est pas incluse.', 'يعرض استخدام API للمؤسسة. لا يشمل استخدام اشتراك ChatGPT عبر Codex.', '显示组织的 API 用量，不包含 Codex 使用的 ChatGPT 订阅用量。'],
  'usage.minimaxNoKey': ['Kein Token-Plan-Key (sk-cp-…). PAYG-Guthaben, Credits und Resource Packs hat MiniMax nur in der Console, eine öffentliche Balance-API gibt es nicht.', 'Not a Token Plan key (sk-cp-…). MiniMax shows PAYG balance, credits and resource packs only in its console; there is no public balance API.', 'No es una clave de Token Plan (sk-cp-…). MiniMax solo muestra el saldo PAYG, créditos y paquetes en su consola; no hay API pública de saldo.', 'Ce n’est pas une clé Token Plan (sk-cp-…). MiniMax n’affiche le solde PAYG, les crédits et les packs que dans sa console ; il n’existe pas d’API publique de solde.', 'ليس مفتاح Token Plan ‏(sk-cp-…). تعرض MiniMax رصيد الدفع حسب الاستخدام والأرصدة والحزم في لوحة التحكم فقط، ولا توجد واجهة API عامة للرصيد.', '不是 Token Plan 密钥（sk-cp-…）。MiniMax 仅在控制台中显示按量余额、额度和资源包，没有公开的余额 API。'],
  'usage.minimaxNoPlan': ['kein aktiver Token Plan', 'no active Token Plan', 'sin Token Plan activo', 'aucun Token Plan actif', 'لا توجد خطة Token نشطة', '没有有效的 Token Plan'],
  'usage.minimaxInvalid': ['Key ungültig oder falscher Key-Typ ({status}: {message})', 'Invalid key or wrong key type ({status}: {message})', 'Clave no válida o tipo de clave incorrecto ({status}: {message})', 'Clé invalide ou mauvais type de clé ({status} : {message})', 'مفتاح غير صالح أو نوع مفتاح خاطئ ({status}: {message})', '密钥无效或类型错误（{status}：{message}）'],
  'usage.minimaxHint': ['Token-Plan-Quote von MiniMax (Anteil verbraucht). Planstufe, Preis und PAYG-Guthaben liefert MiniMax nur in der Console.', 'MiniMax Token Plan quota (share used). MiniMax shows plan tier, price and PAYG balance only in its console.', 'Cuota del Token Plan de MiniMax (porción usada). MiniMax solo muestra el nivel, el precio y el saldo PAYG en su consola.', 'Quota du Token Plan MiniMax (part utilisée). MiniMax n’affiche le niveau, le prix et le solde PAYG que dans sa console.', 'حصة Token Plan من MiniMax (النسبة المستهلكة). تعرض MiniMax مستوى الخطة والسعر ورصيد الدفع حسب الاستخدام في لوحة التحكم فقط.', 'MiniMax Token Plan 配额（已用比例）。套餐等级、价格和按量余额仅在 MiniMax 控制台中显示。'],

  // ---------- commands & dialogs ----------
  'cmd.pickApi': ['Provider für API-Key', 'Provider for the API key', 'Proveedor para la clave API', 'Fournisseur pour la clé API', 'المزوّد الخاص بمفتاح API', 'API 密钥所属的提供商'],
  'cmd.pickAdmin': ['Provider für Usage-Admin-Key', 'Provider for the usage admin key', 'Proveedor para la clave de administración de uso', 'Fournisseur pour la clé admin d’utilisation', 'المزوّد الخاص بمفتاح إدارة الاستخدام', '用量管理密钥所属的提供商'],
  'cmd.apiKeyFor': ['API-Key für {id}', 'API key for {id}', 'Clave API para {id}', 'Clé API pour {id}', 'مفتاح API لـ {id}', '{id} 的 API 密钥'],
  'cmd.adminKeyFor': ['Usage-Admin-Key für {id}', 'Usage admin key for {id}', 'Clave de administración de uso para {id}', 'Clé admin d’utilisation pour {id}', 'مفتاح إدارة الاستخدام لـ {id}', '{id} 的用量管理密钥'],
  'cmd.apiKeyPrompt': ['Wird für Chat-Anfragen dieses Providers benutzt.', 'Used for chat requests to this provider.', 'Se usa para las solicitudes de chat a este proveedor.', 'Utilisée pour les requêtes de chat vers ce fournisseur.', 'يُستخدم لطلبات المحادثة إلى هذا المزوّد.', '用于向此提供商发送对话请求。'],
  'cmd.adminKeyPrompt': ['Admin-/Org-Key mit Leserecht auf die Usage- und Cost-Endpunkte.', 'Admin/organization key with read access to the usage and cost endpoints.', 'Clave de administración/organización con acceso de lectura a los endpoints de uso y coste.', 'Clé admin/organisation avec accès en lecture aux endpoints d’utilisation et de coût.', 'مفتاح إدارة/مؤسسة بصلاحية قراءة نقاط نهاية الاستخدام والتكلفة.', '对用量和费用接口具有读取权限的管理员/组织密钥。'],
  'cmd.keyDeleted': ['Key für {id} gelöscht.', 'Key for {id} deleted.', 'Clave de {id} eliminada.', 'Clé de {id} supprimée.', 'حُذف مفتاح {id}.', '已删除 {id} 的密钥。'],
  'cmd.keySaved': ['Key für {id} gespeichert.', 'Key for {id} saved.', 'Clave de {id} guardada.', 'Clé de {id} enregistrée.', 'حُفظ مفتاح {id}.', '已保存 {id} 的密钥。'],
  'cmd.pickClear': ['Provider, dessen Keys gelöscht werden', 'Provider whose keys will be deleted', 'Proveedor cuyas claves se eliminarán', 'Fournisseur dont les clés seront supprimées', 'المزوّد الذي ستُحذف مفاتيحه', '要删除其密钥的提供商'],
  'cmd.keysDeleted': ['API- und Admin-Key für {id} gelöscht.', 'API and admin key for {id} deleted.', 'Claves API y de administración de {id} eliminadas.', 'Clés API et admin de {id} supprimées.', 'حُذف مفتاحا API والإدارة لـ {id}.', '已删除 {id} 的 API 密钥和管理密钥。'],
  'dialog.attach': ['Anhängen', 'Attach', 'Adjuntar', 'Joindre', 'إرفاق', '附加'],
  'dialog.mention': ['Datei erwähnen', 'Mention a file', 'Mencionar un archivo', 'Mentionner un fichier', 'الإشارة إلى ملف', '引用文件'],
  'dialog.attachFailed': ['Anhang fehlgeschlagen: {error}', 'Attachment failed: {error}', 'Error al adjuntar: {error}', 'Échec de la pièce jointe : {error}', 'فشل الإرفاق: {error}', '附加失败：{error}'],
  'prompt.lookAtFiles': ['Sieh dir die angehängten Dateien an.', 'Take a look at the attached files.', 'Revisa los archivos adjuntos.', 'Regarde les fichiers joints.', 'اطّلع على الملفات المرفقة.', '请查看附加的文件。'],
  'models.fetched': ['{count} Modelle abgerufen, {added} neu{off}.', '{count} models fetched, {added} new{off}.', '{count} modelos obtenidos, {added} nuevos{off}.', '{count} modèles récupérés, {added} nouveaux{off}.', 'جُلب {count} نموذجًا، منها {added} جديدة{off}.', '已获取 {count} 个模型，新增 {added} 个{off}。'],
  'models.fetchedOff': [' (neue sind ausgeschaltet)', ' (new ones are switched off)', ' (los nuevos están desactivados)', ' (les nouveaux sont désactivés)', ' (الجديدة معطّلة)', '（新增的默认停用）'],

  // ---------- errors ----------
  'err.noBaseUrl': ['Kein `baseUrl` in der Provider-Konfiguration.', 'No `baseUrl` in the provider configuration.', 'Falta `baseUrl` en la configuración del proveedor.', 'Aucun `baseUrl` dans la configuration du fournisseur.', 'لا يوجد `baseUrl` في إعدادات المزوّد.', '提供商配置中缺少 `baseUrl`。'],
  'err.noApiKeyHint': ['Kein API-Key gespeichert (PolyMoly: API-Key für Provider setzen).', 'No API key saved (PolyMoly: Set API key for provider).', 'No hay clave API guardada (PolyMoly: Definir clave API del proveedor).', 'Aucune clé API enregistrée (PolyMoly : Définir la clé API du fournisseur).', 'لا يوجد مفتاح API محفوظ (PolyMoly: ضبط مفتاح API للمزوّد).', '未保存 API 密钥（PolyMoly：为提供商设置 API 密钥）。'],
  'err.noApiKey': ['Kein API-Key gespeichert.', 'No API key saved.', 'No hay clave API guardada.', 'Aucune clé API enregistrée.', 'لا يوجد مفتاح API محفوظ.', '未保存 API 密钥。'],
  'err.api': ['API-Fehler.', 'API error.', 'Error de la API.', 'Erreur d’API.', 'خطأ في API.', 'API 错误。'],
  'err.noCommand': ['Kein `command` in der Provider-Konfiguration.', 'No `command` in the provider configuration.', 'Falta `command` en la configuración del proveedor.', 'Aucune `command` dans la configuration du fournisseur.', 'لا يوجد `command` في إعدادات المزوّد.', '提供商配置中缺少 `command`。'],
  'err.commandNotFound': ['`{command}` nicht gefunden (PATH).', '`{command}` not found (PATH).', 'No se encontró `{command}` (PATH).', '`{command}` introuvable (PATH).', 'لم يُعثر على `{command}` ‏(PATH).', '未找到 `{command}`（PATH）。'],
  'err.codexUnknown': ['Unbekannter Codex-Fehler.', 'Unknown Codex error.', 'Error desconocido de Codex.', 'Erreur Codex inconnue.', 'خطأ غير معروف في Codex.', '未知的 Codex 错误。'],
  'err.codex': ['Codex-Fehler.', 'Codex error.', 'Error de Codex.', 'Erreur Codex.', 'خطأ في Codex.', 'Codex 错误。'],
  'err.providerNotFound': ['Provider „{id}“ nicht gefunden.', 'Provider “{id}” not found.', 'No se encontró el proveedor «{id}».', 'Fournisseur « {id} » introuvable.', 'لم يُعثر على المزوّد «{id}».', '未找到提供商“{id}”。'],
  'err.rateLimit': ['Rate limit erreicht.', 'Rate limit reached.', 'Límite de peticiones alcanzado.', 'Limite de débit atteinte.', 'تم بلوغ حد المعدّل.', '已达到速率限制。'],
  'err.fieldNotEditable': ['Feld {field} ist nicht editierbar.', 'Field {field} cannot be edited.', 'El campo {field} no se puede editar.', 'Le champ {field} n’est pas modifiable.', 'الحقل {field} غير قابل للتعديل.', '字段 {field} 不可编辑。'],
  'err.modelIdMissing': ['Modell-ID fehlt.', 'Model ID is missing.', 'Falta el ID del modelo.', 'Identifiant de modèle manquant.', 'معرّف النموذج مفقود.', '缺少模型 ID。'],
  'err.fetchApiOnly': ['Modelle abrufen geht nur bei API-Providern.', 'Fetching models only works for API providers.', 'Solo se pueden obtener modelos de proveedores API.', 'La récupération des modèles ne fonctionne que pour les fournisseurs API.', 'جلب النماذج متاح لمزوّدات API فقط.', '仅 API 提供商支持获取模型。'],
  'err.fetchFailed': ['Abruf fehlgeschlagen: {detail}', 'Fetch failed: {detail}', 'Error al obtener: {detail}', 'Échec de la récupération : {detail}', 'فشل الجلب: {detail}', '获取失败：{detail}'],
  'err.noModelsReturned': ['Der Provider hat keine Modelle geliefert.', 'The provider returned no models.', 'El proveedor no devolvió modelos.', 'Le fournisseur n’a renvoyé aucun modèle.', 'لم يُرجع المزوّد أي نماذج.', '提供商没有返回任何模型。'],
  'err.providerIdMissing': ['Provider-ID fehlt.', 'Provider ID is missing.', 'Falta el ID del proveedor.', 'Identifiant de fournisseur manquant.', 'معرّف المزوّد مفقود.', '缺少提供商 ID。'],
  'err.providerExists': ['Provider „{id}“ existiert schon.', 'Provider “{id}” already exists.', 'El proveedor «{id}» ya existe.', 'Le fournisseur « {id} » existe déjà.', 'المزوّد «{id}» موجود بالفعل.', '提供商“{id}”已存在。'],
  'err.builtinOnlyDisable': ['Eingebaute Provider lassen sich nur ausschalten.', 'Built-in providers can only be switched off.', 'Los proveedores integrados solo se pueden desactivar.', 'Les fournisseurs intégrés peuvent seulement être désactivés.', 'يمكن تعطيل المزوّدات المدمجة فقط.', '内置提供商只能停用。'],
  'err.mcpName': ['MCP-Name: nur Buchstaben, Ziffern, „-“ und „_“.', 'MCP name: only letters, digits, “-” and “_”.', 'Nombre MCP: solo letras, dígitos, «-» y «_».', 'Nom MCP : lettres, chiffres, « - » et « _ » uniquement.', 'اسم MCP: أحرف وأرقام و«-» و«_» فقط.', 'MCP 名称：只能包含字母、数字、“-”和“_”。'],
  'err.mcpUrl': ['MCP-URL fehlt.', 'MCP URL is missing.', 'Falta la URL de MCP.', 'URL MCP manquante.', 'عنوان URL لـ MCP مفقود.', '缺少 MCP URL。'],
  'err.mcpCommand': ['MCP-Befehl fehlt.', 'MCP command is missing.', 'Falta el comando de MCP.', 'Commande MCP manquante.', 'أمر MCP مفقود.', '缺少 MCP 命令。'],
  'err.minimaxEndpoint': ['MiniMax-Token-Plan-Endpunkt nicht erreichbar', 'MiniMax Token Plan endpoint unreachable', 'No se puede acceder al endpoint del Token Plan de MiniMax', 'Endpoint Token Plan MiniMax injoignable', 'تعذّر الوصول إلى نقطة نهاية Token Plan من MiniMax', '无法访问 MiniMax Token Plan 接口'],
  'err.sourceMissing': ['Quelle fehlt.', 'Source is missing.', 'Falta el origen.', 'Source manquante.', 'المصدر مفقود.', '缺少来源。'],
  'err.noSkillMd': ['Keine SKILL.md gefunden.', 'No SKILL.md found.', 'No se encontró ningún SKILL.md.', 'Aucun SKILL.md trouvé.', 'لم يُعثر على SKILL.md.', '未找到 SKILL.md。'],
  'err.pathNotFound': ['Pfad nicht gefunden: {path}', 'Path not found: {path}', 'Ruta no encontrada: {path}', 'Chemin introuvable : {path}', 'المسار غير موجود: {path}', '路径不存在：{path}'],
  'err.expectedSkill': ['Erwartet: Ordner, SKILL.md, .zip oder .skill.', 'Expected: folder, SKILL.md, .zip or .skill.', 'Se esperaba: carpeta, SKILL.md, .zip o .skill.', 'Attendu : dossier, SKILL.md, .zip ou .skill.', 'المتوقع: مجلد أو SKILL.md أو ‎.zip أو ‎.skill.', '应为：文件夹、SKILL.md、.zip 或 .skill。'],
  'err.httpLoad': ['HTTP {status} beim Laden von {url}', 'HTTP {status} while loading {url}', 'HTTP {status} al cargar {url}', 'HTTP {status} lors du chargement de {url}', 'HTTP {status} أثناء تحميل {url}', '加载 {url} 时返回 HTTP {status}'],
  'err.urlNeither': ['Die URL liefert weder eine SKILL.md noch ein ZIP-Archiv.', 'The URL returns neither a SKILL.md nor a ZIP archive.', 'La URL no devuelve ni un SKILL.md ni un archivo ZIP.', 'L’URL ne renvoie ni SKILL.md ni archive ZIP.', 'لا يُرجع الرابط ملف SKILL.md ولا أرشيف ZIP.', '该 URL 返回的既不是 SKILL.md 也不是 ZIP 压缩包。'],

  // ---------- attachments ----------
  'att.noProvider': ['Kein Provider gewählt.', 'No provider selected.', 'No hay proveedor seleccionado.', 'Aucun fournisseur sélectionné.', 'لم يُختر أي مزوّد.', '未选择提供商。'],
  'att.pathOnly': ['Wird nur als Pfad übergeben; der Agent muss die Datei selbst öffnen.', 'Passed as a path only; the agent has to open the file itself.', 'Se pasa solo como ruta; el agente debe abrir el archivo.', 'Transmis uniquement comme chemin ; l’agent doit ouvrir le fichier lui-même.', 'يُمرَّر كمسار فقط؛ على الوكيل فتح الملف بنفسه.', '仅以路径形式传递，代理需要自行打开文件。'],
  'att.noImages': ['{name} sieht keine Bilder. {pathOnly}', '{name} cannot see images. {pathOnly}', '{name} no ve imágenes. {pathOnly}', '{name} ne voit pas les images. {pathOnly}', 'لا يرى {name} الصور. {pathOnly}', '{name} 无法查看图片。{pathOnly}'],
  'att.noPdfDirect': ['{name} liest PDFs nicht direkt. {pathOnly}', '{name} does not read PDFs directly. {pathOnly}', '{name} no lee PDF directamente. {pathOnly}', '{name} ne lit pas les PDF directement. {pathOnly}', 'لا يقرأ {name} ملفات PDF مباشرةً. {pathOnly}', '{name} 不能直接读取 PDF。{pathOnly}'],
  'att.cantPdf': ['{name} kann keine PDFs lesen. {pathOnly}', '{name} cannot read PDFs. {pathOnly}', '{name} no puede leer PDF. {pathOnly}', '{name} ne peut pas lire les PDF. {pathOnly}', 'لا يستطيع {name} قراءة ملفات PDF. {pathOnly}', '{name} 无法读取 PDF。{pathOnly}'],
  'att.cantImages': ['{name} kann keine Bilder lesen. {pathOnly}', '{name} cannot read images. {pathOnly}', '{name} no puede leer imágenes. {pathOnly}', '{name} ne peut pas lire les images. {pathOnly}', 'لا يستطيع {name} قراءة الصور. {pathOnly}', '{name} 无法读取图片。{pathOnly}'],
  'att.binary': ['Binärdatei. {pathOnly}', 'Binary file. {pathOnly}', 'Archivo binario. {pathOnly}', 'Fichier binaire. {pathOnly}', 'ملف ثنائي. {pathOnly}', '二进制文件。{pathOnly}'],
  'att.noImagesBlock': ['{name} nimmt keine Bilder an. Wird nicht gesendet.', '{name} does not accept images. Not sent.', '{name} no acepta imágenes. No se enviará.', '{name} n’accepte pas les images. Non envoyé.', 'لا يقبل {name} الصور. لن يُرسل.', '{name} 不接受图片，不会发送。'],
  'att.imageTooBig': ['Bild größer als {size}. Wird nicht gesendet.', 'Image larger than {size}. Not sent.', 'Imagen mayor de {size}. No se enviará.', 'Image supérieure à {size}. Non envoyée.', 'الصورة أكبر من {size}. لن تُرسل.', '图片超过 {size}，不会发送。'],
  'att.noPdfBlock': ['{name} nimmt keine PDFs an. Wird nicht gesendet.', '{name} does not accept PDFs. Not sent.', '{name} no acepta PDF. No se enviará.', '{name} n’accepte pas les PDF. Non envoyé.', 'لا يقبل {name} ملفات PDF. لن يُرسل.', '{name} 不接受 PDF，不会发送。'],
  'att.pdfTooBig': ['PDF größer als {size}. Wird nicht gesendet.', 'PDF larger than {size}. Not sent.', 'PDF mayor de {size}. No se enviará.', 'PDF supérieur à {size}. Non envoyé.', 'ملف PDF أكبر من {size}. لن يُرسل.', 'PDF 超过 {size}，不会发送。'],
  'att.textTooBig': ['Textdatei größer als {size} KB, zu groß zum Einbetten. Wird nicht gesendet.', 'Text file larger than {size} KB, too big to embed. Not sent.', 'Archivo de texto mayor de {size} KB, demasiado grande para incrustarlo. No se enviará.', 'Fichier texte supérieur à {size} Ko, trop gros pour être intégré. Non envoyé.', 'ملف نصي أكبر من {size} كيلوبايت، كبير جدًا للتضمين. لن يُرسل.', '文本文件超过 {size} KB，太大无法嵌入，不会发送。'],
  'att.unsupported': ['{name} kann diesen Dateityp nicht lesen (keine Dateizugriffe über die API). Wird nicht gesendet.', '{name} cannot read this file type (no file access through the API). Not sent.', '{name} no puede leer este tipo de archivo (sin acceso a archivos por la API). No se enviará.', '{name} ne peut pas lire ce type de fichier (pas d’accès aux fichiers via l’API). Non envoyé.', 'لا يستطيع {name} قراءة هذا النوع من الملفات (لا وصول للملفات عبر API). لن يُرسل.', '{name} 无法读取此类型文件（API 无法访问文件），不会发送。'],

  // ---------- built-in providers & models ----------
  'desc.claude': ['Lokale claude-CLI, nutzt das bestehende Abo oder ANTHROPIC_API_KEY.', 'Local claude CLI, uses your existing subscription or ANTHROPIC_API_KEY.', 'CLI claude local; usa tu suscripción actual o ANTHROPIC_API_KEY.', 'CLI claude locale ; utilise votre abonnement existant ou ANTHROPIC_API_KEY.', 'أداة claude CLI المحلية، تستخدم اشتراكك الحالي أو ANTHROPIC_API_KEY.', '本地 claude CLI，使用现有订阅或 ANTHROPIC_API_KEY。'],
  'desc.codex': ['Lokale codex-CLI (codex exec --json).', 'Local codex CLI (codex exec --json).', 'CLI codex local (codex exec --json).', 'CLI codex locale (codex exec --json).', 'أداة codex CLI المحلية (codex exec --json).', '本地 codex CLI（codex exec --json）。'],
  'desc.minimax': ['OpenAI-kompatible API von MiniMax.', 'MiniMax’s OpenAI-compatible API.', 'API de MiniMax compatible con OpenAI.', 'API de MiniMax compatible OpenAI.', 'واجهة API من MiniMax متوافقة مع OpenAI.', 'MiniMax 的 OpenAI 兼容 API。'],
  'desc.anthropic-api': ['Direkte Messages-API mit eigenem API-Key.', 'Direct Messages API with your own API key.', 'API Messages directa con tu propia clave API.', 'API Messages directe avec votre propre clé API.', 'واجهة Messages API مباشرة بمفتاح API خاص بك.', '使用你自己的 API 密钥直连 Messages API。'],
  'modeldesc.opus': ['Starker Allrounder für komplexe Arbeit', 'Strong all-rounder for complex work', 'Todoterreno potente para trabajo complejo', 'Polyvalent et puissant pour le travail complexe', 'نموذج متكامل وقوي للأعمال المعقّدة', '适合复杂工作的全能型模型'],
  'modeldesc.sonnet': ['Schnell und sparsam für Routine', 'Fast and economical for routine work', 'Rápido y económico para tareas rutinarias', 'Rapide et économique pour les tâches courantes', 'سريع واقتصادي للمهام الروتينية', '快速经济，适合日常任务'],
  'modeldesc.claude-fable-5-1': ['Maximale Leistung für die schwersten Aufgaben · braucht Usage-Credits', 'Maximum capability for the hardest tasks · needs usage credits', 'Máxima capacidad para las tareas más difíciles · requiere créditos de uso', 'Capacité maximale pour les tâches les plus dures · nécessite des crédits d’utilisation', 'أقصى قدرة لأصعب المهام · يتطلب أرصدة استخدام', '为最难的任务提供最强能力 · 需要用量额度'],
  'modeldesc.haiku': ['Am schnellsten für kurze Antworten', 'Quickest for short answers', 'El más rápido para respuestas cortas', 'Le plus rapide pour les réponses courtes', 'الأسرع للإجابات القصيرة', '简短回答最快'],
};

export function resolveLanguage(): Lang {
  const setting = vscode.workspace.getConfiguration('polyagent').get<string>('language', 'auto');
  if (LANGS.includes(setting as Lang)) {
    return setting as Lang;
  }
  const ui = vscode.env.language.toLowerCase().slice(0, 2);
  return LANGS.includes(ui as Lang) ? ui as Lang : 'en';
}

export function format(template: string, vars?: Record<string, string | number>): string {
  return vars ? template.replace(/\{(\w+)\}/g, (all, name) => (name in vars ? String(vars[name]) : all)) : template;
}

function lookup(key: string, lang: Lang): string | undefined {
  const row = M[key];
  return row ? row[LANGS.indexOf(lang)] || row[1] : undefined;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  return format(lookup(key, resolveLanguage()) ?? key, vars);
}

/**
 * Looks up a translation key and returns the translated string if it exists, 
 * otherwise returns undefined. Use for optional text like built-in provider 
 * descriptions that may not have translations.
 * 
 * @param key - The translation key to look up
 * @returns The translated string if the key exists, undefined otherwise
 */
export function tOptional(key: string): string | undefined {
  return lookup(key, resolveLanguage());
}

/** Flat dictionary of one language, injected into the webviews. */
export function webviewStrings(lang: Lang): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(M)) {
    out[key] = lookup(key, lang) ?? key;
  }
  return out;
}

/** `<script>` payload for a webview: language, text direction, number locale and strings. */
export function webviewI18nScript(nonce: string): string {
  const lang = resolveLanguage();
  const payload = { lang, dir: lang === 'ar' ? 'rtl' : 'ltr', locale: LOCALES[lang], strings: webviewStrings(lang) };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<script nonce="${nonce}">window.PM_I18N = ${json};</script>`;
}
