// ============================================================
// LANGUAGES
// ============================================================
//
// The student app in Spanish or Hindi. Rather than touching every place
// that shows text, this watches the page and translates any text (and
// placeholder) that exactly matches a known English phrase, including the
// mistake messages and hints the server sends. Phrases with numbers in
// them ("Question 2 of 5") are handled by the patterns below.
//
// shortcut: student app only, not the teacher page; a phrase not listed
// here stays in English. Add phrases to PHRASES to cover more.
// ============================================================

(() => {
  const LANG_KEY = "studytwin_lang";
  let lang = "en";
  try { lang = localStorage.getItem(LANG_KEY) || "en"; } catch { /* private browsing */ }

  const PHRASES = {
    es: {
      "Show your working. Fix the step that went wrong.": "Muestra tu trabajo. Corrige el paso que salió mal.",
      "Write each line of an equation. StudyTwin checks every step as you go, explains the first mistake, and picks your next question from how you're doing.": "Escribe cada línea de una ecuación. StudyTwin revisa cada paso mientras escribes, explica el primer error y elige tu siguiente pregunta según cómo te va.",
      "Topic": "Tema", "Start at": "Empezar en", "Easy": "Fácil", "Medium": "Media", "Hard": "Difícil",
      "Start practice": "Empezar a practicar", "Practice": "Practicar", "Teach your twin": "Enseña a tu gemelo",
      "Your progress": "Tu progreso", "Dark mode": "Modo oscuro", "Light mode": "Modo claro",
      "Reset my progress": "Borrar mi progreso", "For teachers": "Para docentes",
      "Daily warm-up": "Calentamiento diario", "3 quick questions picked from your own mistakes": "3 preguntas rápidas elegidas a partir de tus propios errores",
      "Start warm-up": "Empezar calentamiento", "Done for today. A new one is ready tomorrow.": "Listo por hoy. Mañana habrá uno nuevo.",
      "Homework from your teacher": "Tarea de tu docente", "Start": "Empezar", "Carry on": "Continuar", "Done": "Hecho",
      "New here? See how it works in four steps": "¿Eres nuevo? Mira cómo funciona en cuatro pasos",
      "In a class? Join with your teacher's code": "¿Estás en una clase? Únete con el código de tu docente",
      "Your working": "Tu trabajo", "One step per line": "Un paso por línea", "Final answer": "Respuesta final",
      "Check answer": "Comprobar respuesta", "Checking…": "Comprobando…", "Checked": "Comprobada",
      "Next question": "Siguiente pregunta", "Show full solution": "Ver la solución completa", "Worked solution": "Solución resuelta",
      "Worked on paper? Add a photo": "¿Lo hiciste en papel? Añade una foto",
      "Start by copying the question, then one step per line": "Empieza copiando la pregunta y luego escribe un paso por línea",
      "Write an equation for the story first, then one step per line": "Primero escribe una ecuación para la historia y luego un paso por línea",
      "Correct": "Correcto", "Not quite yet": "Todavía no", "Right answer, but one step needs fixing": "Respuesta correcta, pero hay que corregir un paso",
      "Correct! Good work.": "¡Correcto! Buen trabajo.", "Your step": "Tu paso", "Correct step": "Paso correcto", "Hint": "Pista",
      "Show the step": "Ver el paso", "Check this line too.": "Revisa también esta línea.",
      "Final line: press Check Answer to see if it's right.": "Última línea: pulsa Comprobar respuesta para ver si es correcta.",
      "Distributive property": "Propiedad distributiva", "Combining like terms": "Reducir términos semejantes",
      "Inverse operations": "Operaciones inversas", "Equation balance": "Equilibrio de ecuaciones",
      "X on both sides": "X en ambos lados", "Negative numbers": "Números negativos",
      "Equations with fractions": "Ecuaciones con fracciones", "Word problems": "Problemas con enunciado",
      "Inequalities": "Desigualdades", "Quadratics": "Ecuaciones cuadráticas", "Simultaneous equations": "Sistemas de ecuaciones", "Factorising": "Factorización",
      "Failed to distribute": "No distribuyó", "Sign error": "Error de signo", "Wrong inverse op": "Operación inversa equivocada",
      "One sided op": "Operación en un solo lado", "Arithmetic slip": "Error de cálculo", "Combining unlike terms": "Sumó términos no semejantes",
      "Inequality flip": "Signo de desigualdad al revés", "Lost a solution": "Perdió una solución",
      "The number outside the brackets was not multiplied by every term inside.": "El número de fuera del paréntesis no se multiplicó por todos los términos de dentro.",
      "Multiply the number outside the brackets by each term inside, including the constant.": "Multiplica el número de fuera del paréntesis por cada término de dentro, también por la constante.",
      "There is a sign error in this step.": "Hay un error de signo en este paso.",
      "Check every + and - carefully when you expand or combine terms.": "Revisa con cuidado cada + y - al desarrollar o reducir términos.",
      "You used the wrong inverse operation in this step.": "Usaste la operación inversa equivocada en este paso.",
      "To undo + you subtract, to undo - you add, to undo multiplication you divide, and to undo division you multiply. Do it on both sides.": "Para deshacer + restas, para deshacer - sumas, para deshacer una multiplicación divides y para deshacer una división multiplicas. Hazlo en ambos lados.",
      "You changed only one side of the equation.": "Solo cambiaste un lado de la ecuación.",
      "Whatever you do to one side of an equation, you must do to the other side too.": "Lo que hagas en un lado de la ecuación, debes hacerlo también en el otro.",
      "You combined terms that are not like terms.": "Sumaste términos que no son semejantes.",
      "Only terms with the same variable part can be combined. x-terms and plain numbers stay separate.": "Solo se pueden sumar términos con la misma parte literal. Los términos con x y los números van por separado.",
      "The method in this step looks right, but there is an arithmetic slip.": "El método de este paso parece correcto, pero hay un error de cálculo.",
      "Recompute this step carefully.": "Vuelve a calcular este paso con cuidado.",
      "This equation doesn't match the story.": "Esta ecuación no corresponde a la historia.",
      "The inequality sign is the wrong way round here.": "Aquí el signo de desigualdad está al revés.",
      "This line loses one of the solutions.": "En esta línea se pierde una de las soluciones.",
      "This line doesn't follow from the one before.": "Esta línea no se deduce de la anterior.",
      "This step changes the value of the equation.": "Este paso cambia el valor de la ecuación."
    },
    hi: {
      "Show your working. Fix the step that went wrong.": "अपना हल दिखाएँ। जो चरण गलत हुआ, उसे ठीक करें।",
      "Write each line of an equation. StudyTwin checks every step as you go, explains the first mistake, and picks your next question from how you're doing.": "समीकरण की हर पंक्ति लिखें। StudyTwin लिखते समय हर चरण जाँचता है, पहली गलती समझाता है और आपके प्रदर्शन के आधार पर अगला प्रश्न चुनता है।",
      "Topic": "विषय", "Start at": "स्तर", "Easy": "आसान", "Medium": "मध्यम", "Hard": "कठिन",
      "Start practice": "अभ्यास शुरू करें", "Practice": "अभ्यास", "Teach your twin": "अपने जुड़वाँ को सिखाएँ",
      "Your progress": "आपकी प्रगति", "Dark mode": "डार्क मोड", "Light mode": "लाइट मोड",
      "Reset my progress": "मेरी प्रगति मिटाएँ", "For teachers": "शिक्षकों के लिए",
      "Daily warm-up": "रोज़ का वॉर्म-अप", "3 quick questions picked from your own mistakes": "आपकी अपनी गलतियों से चुने गए 3 छोटे प्रश्न",
      "Start warm-up": "वॉर्म-अप शुरू करें", "Done for today. A new one is ready tomorrow.": "आज का हो गया। कल नया तैयार रहेगा।",
      "Homework from your teacher": "आपके शिक्षक का गृहकार्य", "Start": "शुरू करें", "Carry on": "जारी रखें", "Done": "पूरा",
      "New here? See how it works in four steps": "नए हैं? चार चरणों में देखें यह कैसे काम करता है",
      "In a class? Join with your teacher's code": "किसी कक्षा में हैं? शिक्षक के कोड से जुड़ें",
      "Your working": "आपका हल", "One step per line": "हर पंक्ति में एक चरण", "Final answer": "अंतिम उत्तर",
      "Check answer": "उत्तर जाँचें", "Checking…": "जाँच रहे हैं…", "Checked": "जाँचा गया",
      "Next question": "अगला प्रश्न", "Show full solution": "पूरा हल दिखाएँ", "Worked solution": "हल किया हुआ उत्तर",
      "Worked on paper? Add a photo": "काग़ज़ पर हल किया? फ़ोटो जोड़ें",
      "Start by copying the question, then one step per line": "पहले प्रश्न लिखें, फिर हर पंक्ति में एक चरण",
      "Write an equation for the story first, then one step per line": "पहले कहानी के लिए समीकरण लिखें, फिर हर पंक्ति में एक चरण",
      "Correct": "सही", "Not quite yet": "अभी पूरा सही नहीं", "Right answer, but one step needs fixing": "उत्तर सही है, पर एक चरण ठीक करना है",
      "Correct! Good work.": "सही! बहुत अच्छा।", "Your step": "आपका चरण", "Correct step": "सही चरण", "Hint": "संकेत",
      "Show the step": "चरण दिखाएँ", "Check this line too.": "यह पंक्ति भी जाँचें।",
      "Final line: press Check Answer to see if it's right.": "अंतिम पंक्ति: सही है या नहीं, जानने के लिए उत्तर जाँचें दबाएँ।",
      "Distributive property": "वितरण गुण", "Combining like terms": "समान पदों को जोड़ना",
      "Inverse operations": "विपरीत संक्रियाएँ", "Equation balance": "समीकरण का संतुलन",
      "X on both sides": "दोनों ओर x", "Negative numbers": "ऋणात्मक संख्याएँ",
      "Equations with fractions": "भिन्न वाले समीकरण", "Word problems": "शाब्दिक प्रश्न",
      "Inequalities": "असमिकाएँ", "Quadratics": "द्विघात समीकरण", "Simultaneous equations": "युगपत समीकरण", "Factorising": "गुणनखंडन",
      "Failed to distribute": "वितरण नहीं किया", "Sign error": "चिह्न की गलती", "Wrong inverse op": "गलत विपरीत संक्रिया",
      "One sided op": "केवल एक ओर बदलाव", "Arithmetic slip": "गणना की भूल", "Combining unlike terms": "असमान पदों को जोड़ा",
      "Inequality flip": "असमिका का चिह्न उल्टा", "Lost a solution": "एक हल छूट गया",
      "The number outside the brackets was not multiplied by every term inside.": "कोष्ठक के बाहर की संख्या को अंदर के हर पद से गुणा नहीं किया गया।",
      "Multiply the number outside the brackets by each term inside, including the constant.": "कोष्ठक के बाहर की संख्या को अंदर के हर पद से गुणा करें, अचर पद से भी।",
      "There is a sign error in this step.": "इस चरण में चिह्न की गलती है।",
      "Check every + and - carefully when you expand or combine terms.": "पद खोलते या जोड़ते समय हर + और - ध्यान से जाँचें।",
      "You used the wrong inverse operation in this step.": "इस चरण में आपने गलत विपरीत संक्रिया की।",
      "To undo + you subtract, to undo - you add, to undo multiplication you divide, and to undo division you multiply. Do it on both sides.": "+ हटाने के लिए घटाएँ, - हटाने के लिए जोड़ें, गुणा हटाने के लिए भाग दें और भाग हटाने के लिए गुणा करें। यह दोनों ओर करें।",
      "You changed only one side of the equation.": "आपने समीकरण की केवल एक ओर बदलाव किया।",
      "Whatever you do to one side of an equation, you must do to the other side too.": "समीकरण की एक ओर जो भी करें, वही दूसरी ओर भी करना होगा।",
      "You combined terms that are not like terms.": "आपने असमान पदों को जोड़ दिया।",
      "Only terms with the same variable part can be combined. x-terms and plain numbers stay separate.": "केवल समान चर वाले पद जुड़ते हैं। x वाले पद और संख्याएँ अलग रहती हैं।",
      "The method in this step looks right, but there is an arithmetic slip.": "इस चरण का तरीका सही लगता है, पर गणना में भूल है।",
      "Recompute this step carefully.": "यह चरण ध्यान से दोबारा गणना करें।",
      "This equation doesn't match the story.": "यह समीकरण कहानी से मेल नहीं खाता।",
      "The inequality sign is the wrong way round here.": "यहाँ असमिका का चिह्न उल्टा है।",
      "This line loses one of the solutions.": "इस पंक्ति में एक हल छूट जाता है।",
      "This line doesn't follow from the one before.": "यह पंक्ति पिछली पंक्ति से नहीं निकलती।",
      "This step changes the value of the equation.": "यह चरण समीकरण का मान बदल देता है।"
    }
  };

  // Phrases with numbers or a variable part.
  const PATTERNS = {
    es: [
      [/^Question (\d+) of (\d+)$/, "Pregunta $1 de $2"],
      [/^Warm-up (\d+) of (\d+)$/, "Calentamiento $1 de $2"],
      [/^Something isn't right in line (\d+)\. Can you spot it\?$/, "Algo no está bien en la línea $1. ¿Lo encuentras?"],
      [/^Hint: (.+)$/, (m, rest) => `Pista: ${translate(rest)}`],
      [/^Your final answer is right, but one of your steps is not: (.+)$/, (m, rest) => `Tu respuesta final es correcta, pero uno de tus pasos no: ${translate(rest)}`]
    ],
    hi: [
      [/^Question (\d+) of (\d+)$/, "प्रश्न $1 / $2"],
      [/^Warm-up (\d+) of (\d+)$/, "वॉर्म-अप $1 / $2"],
      [/^Something isn't right in line (\d+)\. Can you spot it\?$/, "पंक्ति $1 में कुछ गलत है। क्या आप ढूँढ सकते हैं?"],
      [/^Hint: (.+)$/, (m, rest) => `संकेत: ${translate(rest)}`],
      [/^Your final answer is right, but one of your steps is not: (.+)$/, (m, rest) => `आपका अंतिम उत्तर सही है, पर आपका एक चरण सही नहीं है: ${translate(rest)}`]
    ]
  };

  function translate(text) {
    const phrases = PHRASES[lang];
    if (!phrases) return text;
    const trimmed = text.trim();
    if (phrases[trimmed]) return text.replace(trimmed, phrases[trimmed]);
    for (const [pattern, replacement] of PATTERNS[lang] || []) {
      if (pattern.test(trimmed)) return text.replace(trimmed, trimmed.replace(pattern, replacement));
    }
    return text;
  }

  // Only write when something changes: writing the same value would wake
  // the observer again and loop forever.
  function translatePlaceholder(element) {
    if (!element.placeholder) return;
    const next = translate(element.placeholder);
    if (next !== element.placeholder) element.placeholder = next;
  }

  function translateNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const next = translate(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    translatePlaceholder(node);
    // Leave what the student typed and the maths itself alone.
    if (node.matches("textarea, input, code, script, style")) return;
    node.childNodes.forEach(translateNode);
  }

  window.studytwinLanguage = lang;

  document.addEventListener("DOMContentLoaded", () => {
    const picker = document.getElementById("langSelect");
    if (picker) {
      picker.value = lang;
      picker.addEventListener("change", () => {
        try { localStorage.setItem(LANG_KEY, picker.value); } catch { /* ignore */ }
        location.reload();
      });
    }
    if (lang === "en" || !PHRASES[lang]) return;
    document.documentElement.lang = lang;
    translateNode(document.body);
    new MutationObserver((changes) => {
      for (const change of changes) {
        if (change.type === "characterData") translateNode(change.target);
        else if (change.type === "attributes") translateNode(change.target);
        else change.addedNodes.forEach(translateNode);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder"] });
  });
})();
