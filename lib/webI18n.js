'use strict';

/**
 * Lightweight, private-by-default website localization. The browser locale is
 * used only for presentation; it does not change the user's catalog country or
 * TMDB language. An explicit choice is saved locally and can be reset to Auto.
 */

const LANGUAGES = ['es', 'en', 'pt', 'fr', 'de', 'it'];
const LANGUAGE_OPTIONS = [
  ['auto', 'Auto'],
  ['es', 'Español'],
  ['en', 'English'],
  ['pt', 'Português'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['it', 'Italiano'],
];
const { LANG_OPTIONS: CATALOG_LANG_OPTIONS, REGION_OPTIONS } = require('./userConfig');

const WEB_LANGUAGE_STORAGE_KEY = 'catalogos-plus-web-language-v1';

// Run in <head> before the page is painted: avoid hiding the Spanish fallback
// while still preventing a flash of Spanish for visitors who prefer another
// supported language. The full dictionary is applied after the DOM is ready.
const WEB_I18N_BOOTSTRAP = `
(function () {
  'use strict';
  var languages = ${JSON.stringify(LANGUAGES)};
  var language = '';
  try {
    var saved = localStorage.getItem(${JSON.stringify(WEB_LANGUAGE_STORAGE_KEY)});
    if (languages.indexOf(saved) !== -1) language = saved;
  } catch (_) {}
  if (!language) {
    var preferences = Array.isArray(navigator.languages) ? navigator.languages : [];
    if (navigator.language) preferences = preferences.concat([navigator.language]);
    for (var i = 0; i < preferences.length; i += 1) {
      var base = String(preferences[i] || '').trim().toLowerCase().split(/[-_]/)[0];
      if (languages.indexOf(base) !== -1) { language = base; break; }
    }
  }
  if (!language) language = 'es';
  document.documentElement.lang = language;
  if (language !== 'es') document.documentElement.setAttribute('data-i18n-pending', '');
})();
`;

// [Spanish source phrase, English, Portuguese, French, German, Italian].
// Brand names, platform names, movie titles and technical labels stay as-is.
const PHRASES = [
  ['Idioma de la web', 'Website language', 'Idioma do site', 'Langue du site', 'Website-Sprache', 'Lingua del sito'],
  ['Auto', 'Automatic', 'Automático', 'Automatique', 'Automatisch', 'Automatico'],
  ['Inicio', 'Home', 'Início', 'Accueil', 'Startseite', 'Home'],
  ['Tendencias', 'Trending', 'Em alta', 'Tendances', 'Trends', 'Tendenze'],
  ['Funciones', 'Features', 'Recursos', 'Fonctionnalités', 'Funktionen', 'Funzionalità'],
  ['Cómo funciona', 'How it works', 'Como funciona', 'Comment ça marche', 'So funktioniert es', 'Come funziona'],
  ['Preguntas', 'FAQ', 'Perguntas', 'Questions', 'Fragen', 'Domande'],
  ['Soporte', 'Support', 'Suporte', 'Assistance', 'Support', 'Supporto'],
  ['Configurar', 'Configure', 'Configurar', 'Configurer', 'Konfigurieren', 'Configura'],
  ['Instalar', 'Install', 'Instalar', 'Installer', 'Installieren', 'Installa'],
  ['Plataformas', 'Platforms', 'Plataformas', 'Plateformes', 'Plattformen', 'Piattaforme'],
  ['Estudios', 'Studios', 'Estúdios', 'Studios', 'Studios', 'Studi'],
  ['Filtros', 'Filters', 'Filtros', 'Filtres', 'Filter', 'Filtri'],
  ['Catálogos+', 'Catálogos+', 'Catálogos+', 'Catálogos+', 'Catálogos+', 'Catálogos+'],
  ['Catálogos', 'Catalogs', 'Catálogos', 'Catalogues', 'Kataloge', 'Cataloghi'],
  ['Catálogos base', 'Base catalogs', 'Catálogos base', 'Catalogues de base', 'Basiskataloge', 'Cataloghi base'],
  ['Idioma y región', 'Language and region', 'Idioma e região', 'Langue et région', 'Sprache und Region', 'Lingua e regione'],
  ['Servicios debrid', 'Debrid services', 'Serviços de debrid', 'Services de debrid', 'Debrid-Dienste', 'Servizi debrid'],
  ['Proveedores', 'Providers', 'Provedores', 'Fournisseurs', 'Anbieter', 'Provider'],
  ['Proveedores de streams', 'Stream providers', 'Provedores de streams', 'Fournisseurs de streams', 'Stream-Anbieter', 'Provider di stream'],
  ['Tu Stremio', 'Your Stremio', 'Seu Stremio', 'Votre Stremio', 'Dein Stremio', 'Il tuo Stremio'],
  ['a tu manera.', 'your way.', 'do seu jeito.', 'à votre façon.', 'auf deine Art.', 'a modo tuo.'],
  ['a tu gusto.', 'your way.', 'do seu jeito.', 'à votre goût.', 'nach deinem Geschmack.', 'a modo tuo.'],
  ['Idioma, región y filtros a tu gusto', 'Language, region and filters your way', 'Idioma, região e filtros do seu jeito', 'Langue, région et filtres à votre goût', 'Sprache, Region und Filter nach deinem Geschmack', 'Lingua, regione e filtri a modo tuo'],
  ['Descubre películas y series con', 'Discover movies and series with', 'Descubra filmes e séries com', 'Découvrez des films et séries avec', 'Entdecke Filme und Serien mit', 'Scopri film e serie con'],
  ['por plataforma y estudio. Ajusta idioma, región y calidad para encontrar tu próxima historia.', 'across platforms and studios. Set your language, region and quality filters to find your next story.', 'por plataforma e estúdio. Ajuste idioma, região e qualidade para encontrar sua próxima história.', 'par plateforme et studio. Choisissez la langue, la région et la qualité pour trouver votre prochaine histoire.', 'nach Plattform und Studio. Wähle Sprache, Region und Qualität, um deine nächste Geschichte zu finden.', 'per piattaforma e studio. Scegli lingua, regione e qualità per trovare la tua prossima storia.'],
  ['Gratis y sin cuenta.', 'Free, no account required.', 'Grátis e sem conta.', 'Gratuit, sans compte.', 'Kostenlos und ohne Konto.', 'Gratis e senza account.'],
  ['Gratis', 'Free', 'Grátis', 'Gratuit', 'Kostenlos', 'Gratis'],
  ['Sin registro', 'No sign-up', 'Sem cadastro', 'Sans inscription', 'Keine Registrierung', 'Senza registrazione'],
  ['Hecho para Stremio', 'Made for Stremio', 'Feito para o Stremio', 'Conçu pour Stremio', 'Für Stremio gemacht', 'Pensato per Stremio'],
  ['Instalar en Stremio', 'Install on Stremio', 'Instalar no Stremio', 'Installer sur Stremio', 'In Stremio installieren', 'Installa su Stremio'],
  ['Personalizar', 'Customize', 'Personalizar', 'Personnaliser', 'Anpassen', 'Personalizza'],
  ['Personalizar primero', 'Customize first', 'Personalizar primeiro', 'Personnaliser d’abord', 'Zuerst anpassen', 'Personalizza prima'],
  ['Tu Stremio,', 'Your Stremio,', 'Seu Stremio,', 'Votre Stremio,', 'Dein Stremio,', 'Il tuo Stremio,'],
  ['Configurador', 'Configurator', 'Configurador', 'Configurateur', 'Konfigurator', 'Configuratore'],
  ['Empieza aquí', 'Start here', 'Comece aqui', 'Commencez ici', 'Hier starten', 'Inizia qui'],
  ['3 pasos · sin complicaciones', '3 easy steps', '3 passos · sem complicação', '3 étapes · tout simplement', '3 einfache Schritte', '3 passaggi · senza complicazioni'],
  ['Elige el idioma de los títulos y tu país.', 'Choose the language for titles and your country.', 'Escolha o idioma dos títulos e seu país.', 'Choisissez la langue des titres et votre pays.', 'Wähle die Titelsprache und dein Land.', 'Scegli la lingua dei titoli e il tuo paese.'],
  ['Elige qué aparece', 'Choose what appears', 'Escolha o que aparece', 'Choisissez ce qui s’affiche', 'Wähle, was angezeigt wird', 'Scegli cosa mostrare'],
  ['Marca tus plataformas; puedes dejar lo demás como está.', 'Select your platforms; you can leave everything else as is.', 'Marque suas plataformas; você pode deixar o restante como está.', 'Choisissez vos plateformes ; vous pouvez laisser le reste tel quel.', 'Wähle deine Plattformen; alles andere kann bleiben, wie es ist.', 'Seleziona le piattaforme; puoi lasciare tutto il resto così com’è.'],
  ['Afina tus streams', 'Fine-tune your streams', 'Ajuste seus streams', 'Affinez vos streams', 'Passe deine Streams an', 'Personalizza gli stream'],
  ['Prueba «Recomendado» y luego instala desde abajo.', 'Try “Recommended”, then install using the button below.', 'Experimente “Recomendado” e instale pelo botão abaixo.', 'Essayez « Recommandé », puis installez avec le bouton ci-dessous.', 'Probiere „Empfohlen“ und installiere dann über die Schaltfläche unten.', 'Prova “Consigliato” e installa dal pulsante in basso.'],
  ['Sugerencia: empieza por «Recomendado» para ocultar CAM, screener y 3D. Debrid es opcional.', 'Tip: start with “Recommended” to hide CAM, screeners and 3D. Debrid is optional.', 'Dica: comece por “Recomendado” para ocultar CAM, screener e 3D. Debrid é opcional.', 'Conseil : commencez par « Recommandé » pour masquer CAM, screener et 3D. Debrid est facultatif.', 'Tipp: Wähle zuerst „Empfohlen“, um CAM, Screener und 3D auszublenden. Debrid ist optional.', 'Suggerimento: inizia da “Consigliato” per nascondere CAM, screener e 3D. Debrid è facoltativo.'],
  ['Tus streams, a tu gusto', 'Your streams, your way', 'Seus streams, do seu jeito', 'Vos streams, à votre goût', 'Deine Streams, ganz nach Wunsch', 'I tuoi stream, a modo tuo'],
  ['oculto', 'hidden', 'oculto', 'masqué', 'ausgeblendet', 'nascosto'],
  ['ocultos', 'hidden', 'ocultos', 'masqués', 'ausgeblendet', 'nascosti'],
  ['catálogos', 'catalogs', 'catálogos', 'catalogues', 'Kataloge', 'cataloghi'],
  ['proveedores', 'providers', 'provedores', 'fournisseurs', 'Anbieter', 'provider'],
  ['idioma', 'language', 'idioma', 'langue', 'Sprache', 'lingua'],
  ['región', 'region', 'região', 'région', 'Region', 'regione'],
  ['filtro', 'filter', 'filtro', 'filtre', 'Filter', 'filtro'],
  ['plataformas', 'platforms', 'plataformas', 'plateformes', 'Plattformen', 'piattaforme'],
  ['estudios', 'studios', 'estúdios', 'studios', 'Studios', 'studi'],
  ['idiomas', 'languages', 'idiomas', 'langues', 'Sprachen', 'lingue'],
  ['regiones', 'regions', 'regiões', 'régions', 'Regionen', 'regioni'],
  ['filtros', 'filters', 'filtros', 'filtres', 'Filter', 'filtri'],
  ['filtros de streams', 'stream filters', 'filtros de streams', 'filtres de streams', 'Stream-Filter', 'filtri degli stream'],
  ['proveedores de streams', 'stream providers', 'provedores de streams', 'fournisseurs de streams', 'Stream-Anbieter', 'provider di stream'],
  ['Explorar por', 'Explore by', 'Explorar por', 'Explorer par', 'Entdecken nach', 'Esplora per'],
  ['plataforma', 'platform', 'plataforma', 'plateforme', 'Plattform', 'piattaforma'],
  ['Elegir las mías', 'Choose mine', 'Escolher as minhas', 'Choisir les miennes', 'Meine auswählen', 'Scegli le mie'],
  ['Ahora mismo', 'Right now', 'Agora', 'En ce moment', 'Jetzt gerade', 'Adesso'],
  ['Tendencias de la', 'Trending this', 'Em alta nesta', 'Tendances de la', 'Trends der', 'Tendenze della'],
  ['semana', 'week', 'semana', 'semaine', 'Woche', 'settimana'],
  ['Películas', 'Movies', 'Filmes', 'Films', 'Filme', 'Film'],
  ['Series', 'Series', 'Séries', 'Séries', 'Serien', 'Serie'],
  ['Serie', 'Series', 'Série', 'Série', 'Serie', 'Serie'],
  ['Película', 'Movie', 'Filme', 'Film', 'Film', 'Film'],
  ['Anime', 'Anime', 'Anime', 'Anime', 'Anime', 'Anime'],
  ['Filtrar esta portada…', 'Filter this page…', 'Filtrar esta página…', 'Filtrer cette page…', 'Diese Seite filtern…', 'Filtra questa pagina…'],
  ['Filtrar los pósters de esta página', 'Filter posters on this page', 'Filtrar os pôsteres desta página', 'Filtrer les affiches de cette page', 'Poster auf dieser Seite filtern', 'Filtra i poster di questa pagina'],
  ['Nada en esta portada con ese título.', 'Nothing on this page matches that title.', 'Nada nesta página corresponde a esse título.', 'Aucun résultat sur cette page pour ce titre.', 'Kein Treffer auf dieser Seite für diesen Titel.', 'Nessun risultato in questa pagina per questo titolo.'],
  ['Instala el addon', 'Install the add-on', 'Instale o complemento', 'Installez l’extension', 'Installiere das Add-on', 'Installa l’add-on'],
  ['para buscar en todos los catálogos desde Stremio.', 'to search all catalogs in Stremio.', 'para buscar em todos os catálogos no Stremio.', 'pour rechercher dans tous les catalogues depuis Stremio.', 'um alle Kataloge in Stremio zu durchsuchen.', 'per cercare in tutti i cataloghi da Stremio.'],
  ['en tendencia esta semana', 'trending this week', 'em alta nesta semana', 'tendances de la semaine', 'diese Woche im Trend', 'di tendenza questa settimana'],
  ['popular', 'popular', 'popular', 'populaire', 'beliebt', 'popolare'],
  ['Todo lo que trae', 'Everything in', 'Tudo o que o', 'Tout ce que propose', 'Alles, was', 'Tutto quello che offre'],
  ['Catálogos que se llenan solos, fichas con toda la información y streams que respetan lo que quieres ver.', 'Auto-updating catalogs, detailed title pages and streams tailored to what you want to watch.', 'Catálogos que se atualizam sozinhos, páginas completas e streams de acordo com o que você quer assistir.', 'Des catalogues mis à jour automatiquement, des fiches complètes et des streams adaptés à vos envies.', 'Automatisch aktualisierte Kataloge, ausführliche Titelinfos und Streams passend zu deinen Wünschen.', 'Cataloghi sempre aggiornati, schede complete e stream in base a ciò che vuoi guardare.'],
  ['Filtros de streams', 'Stream filters', 'Filtros de streams', 'Filtres de streams', 'Stream-Filter', 'Filtri degli stream'],
  ['Nuevo', 'New', 'Novo', 'Nouveau', 'Neu', 'Nuovo'],
  ['Desmarca lo que no quieres y deja de aparecer en Stremio: copias', 'Uncheck what you don’t want to see and it disappears from Stremio: copies', 'Desmarque o que não quer ver para ocultar no Stremio: cópias', 'Décochez ce que vous ne voulez pas voir pour le masquer dans Stremio : copies', 'Wähle ab, was in Stremio ausgeblendet werden soll: Kopien', 'Deseleziona ciò che vuoi nascondere in Stremio: copie'],
  ['y screeners,', 'and screeners,', 'e screeners,', 'et screeners,', 'und Screeners,', 'e screener,'],
  [', REMUX enormes, Dolby Vision, HEVC, AV1… Además eliges el orden (seeders, calidad o tamaño) y un tamaño máximo.', ', huge REMUX files, Dolby Vision, HEVC, AV1… You can also sort by seeders, quality or size and set a maximum file size.', ', REMUX enormes, Dolby Vision, HEVC, AV1… Também escolha a ordem (seeders, qualidade ou tamanho) e o tamanho máximo.', ', les gros REMUX, Dolby Vision, HEVC, AV1… Choisissez aussi le tri (seeders, qualité ou taille) et une taille maximale.', ', riesige REMUX-Dateien, Dolby Vision, HEVC, AV1… Sortiere auch nach Seedern, Qualität oder Größe und lege eine Maximalgröße fest.', ', REMUX enormi, Dolby Vision, HEVC, AV1… Scegli anche l’ordinamento (seeders, qualità o dimensione) e una dimensione massima.'],
  ['Elegir mis filtros', 'Choose my filters', 'Escolher meus filtros', 'Choisir mes filtres', 'Meine Filter wählen', 'Scegli i miei filtri'],
  ['Al abrir una película o un episodio se consultan en paralelo y se quitan los duplicados. Nyaa cubre el anime, YTS las películas, EZTV las series y el Índice BR el contenido en portugués (Dublado y Dual Áudio).', 'When you open a movie or episode, providers are queried in parallel and duplicate results are removed. Nyaa covers anime, YTS movies, EZTV series and Índice BR Portuguese-language releases (Dublado and Dual Áudio).', 'Ao abrir um filme ou episódio, as fontes são consultadas em paralelo e os duplicados são removidos. Nyaa cobre anime; YTS, filmes; EZTV, séries; o Índice BR, o conteúdo em português (Dublado e Dual Áudio).', 'À l’ouverture d’un film ou épisode, les sources sont interrogées en parallèle et les doublons sont supprimés. Nyaa pour l’anime, YTS pour les films, EZTV pour les séries et Índice BR pour le contenu en portugais (Dublado et Dual Áudio).', 'Beim Öffnen eines Films oder einer Folge werden Quellen parallel abgefragt und Duplikate entfernt. Nyaa für Anime, YTS für Filme, EZTV für Serien und Índice BR für portugiesische Fassungen (Dublado und Dual Áudio).', 'Quando apri un film o un episodio, le fonti vengono consultate in parallelo e i duplicati rimossi. Nyaa per gli anime, YTS per i film, EZTV per le serie e Índice BR per i contenuti in portoghese (Dublado e Dual Áudio).'],
  ['Títulos, sinopsis y pósters en el idioma que elijas, del español latino al japonés.', 'Titles, summaries and posters in your chosen language, from Latin American Spanish to Japanese.', 'Títulos, sinopses e pôsteres no idioma escolhido, do espanhol latino ao japonês.', 'Titres, résumés et affiches dans la langue choisie, de l’espagnol latino-américain au japonais.', 'Titel, Zusammenfassungen und Poster in deiner Sprache, von lateinamerikanischem Spanisch bis Japanisch.', 'Titoli, trame e poster nella lingua scelta, dallo spagnolo latino al giapponese.'],
  ['Cada plataforma muestra lo que ofrece en tu país, y la cartelera de cines es la tuya.', 'Each platform shows what’s available in your country, along with local cinema listings.', 'Cada plataforma mostra o que oferece no seu país, e os filmes em cartaz são os da sua região.', 'Chaque plateforme affiche son offre dans votre pays, avec les films à l’affiche près de chez vous.', 'Jede Plattform zeigt ihr Angebot in deinem Land, dazu das aktuelle Kinoprogramm.', 'Ogni piattaforma mostra cosa offre nel tuo paese, con i film in sala nella tua zona.'],
  ['Netflix, Disney+, Max, Hulu, AMC+… y Marvel, Pixar, A24 o Ghibli, cada uno con su catálogo de películas y de series.', 'Netflix, Disney+, Max, Hulu, AMC+… plus Marvel, Pixar, A24 and Ghibli, each with movie and series catalogs.', 'Netflix, Disney+, Max, Hulu, AMC+… e Marvel, Pixar, A24 ou Ghibli, cada um com catálogos de filmes e séries.', 'Netflix, Disney+, Max, Hulu, AMC+… ainsi que Marvel, Pixar, A24 ou Ghibli, chacun avec ses catalogues de films et de séries.', 'Netflix, Disney+, Max, Hulu, AMC+… sowie Marvel, Pixar, A24 oder Ghibli – jeweils mit Film- und Serienkatalogen.', 'Netflix, Disney+, Max, Hulu, AMC+… e Marvel, Pixar, A24 o Ghibli, ognuno con cataloghi di film e serie.'],
  ['Fichas con todas las notas', 'Title pages with every rating', 'Fichas com todas as avaliações', 'Fiches avec toutes les notes', 'Titelinfos mit allen Bewertungen', 'Schede con tutte le valutazioni'],
  ['IMDb, Rotten Tomatoes y Metacritic junto a la puntuación de TMDB, con reparto, dirección y géneros.', 'IMDb, Rotten Tomatoes and Metacritic alongside TMDB ratings, cast, directors and genres.', 'IMDb, Rotten Tomatoes e Metacritic junto da nota do TMDB, com elenco, direção e gêneros.', 'IMDb, Rotten Tomatoes et Metacritic avec la note TMDB, le casting, la réalisation et les genres.', 'IMDb, Rotten Tomatoes und Metacritic neben der TMDB-Wertung, mit Besetzung, Regie und Genres.', 'IMDb, Rotten Tomatoes e Metacritic insieme al voto TMDB, con cast, regia e generi.'],
  ['Dónde verlo ahora', 'Where to watch now', 'Onde assistir agora', 'Où regarder maintenant', 'Wo jetzt ansehen', 'Dove guardarlo ora'],
  ['Cada ficha indica en qué plataformas está disponible en tu región: «Disponible en Netflix · Max · Hulu…».', 'Each title shows which platforms stream it in your region: “Available on Netflix · Max · Hulu…”.', 'Cada ficha mostra em quais plataformas está disponível na sua região: “Disponível em Netflix · Max · Hulu…”.', 'Chaque fiche indique les plateformes disponibles dans votre région : « Disponible sur Netflix · Max · Hulu… ».', 'Jede Seite zeigt verfügbare Plattformen in deiner Region: „Verfügbar bei Netflix · Max · Hulu…“.', 'Ogni scheda indica le piattaforme disponibili nella tua regione: “Disponibile su Netflix · Max · Hulu…”.'],
  ['Listo en', 'Ready in', 'Pronto em', 'Prêt en', 'Fertig in', 'Pronto in'],
  ['tres pasos', 'three steps', 'três passos', 'trois étapes', 'drei Schritten', 'tre passaggi'],
  ['Abrir el configurador', 'Open the configurator', 'Abrir o configurador', 'Ouvrir le configurateur', 'Konfigurator öffnen', 'Apri il configuratore'],
  ['Elige', 'Choose', 'Escolha', 'Choisissez', 'Auswählen', 'Scegli'],
  ['Idioma, región, plataformas, estudios y qué streams quieres ver. O sáltate este paso: lo de serie ya funciona.', 'Choose your language, region, platforms, studios and streams. Or skip this step: the defaults already work.', 'Escolha idioma, região, plataformas, estúdios e os streams que quer ver. Ou pule esta etapa: os padrões já funcionam.', 'Choisissez langue, région, plateformes, studios et streams. Vous pouvez aussi ignorer cette étape : les réglages par défaut fonctionnent déjà.', 'Wähle Sprache, Region, Plattformen, Studios und gewünschte Streams. Oder überspringe diesen Schritt: Die Voreinstellungen funktionieren bereits.', 'Scegli lingua, regione, piattaforme, studi e stream. Oppure salta questo passaggio: le impostazioni predefinite funzionano già.'],
  ['Instala', 'Install', 'Instale', 'Installez', 'Installieren', 'Installa'],
  ['Un clic en «Instalar en Stremio» abre la app con tu selección. También puedes copiar la URL y pegarla en Addons.', 'Click “Install on Stremio” to open the app with your selection. Or copy the URL and paste it into Add-ons.', 'Clique em “Instalar no Stremio” para abrir o app com sua seleção. Ou copie a URL e cole em Add-ons.', 'Cliquez sur « Installer sur Stremio » pour ouvrir l’app avec votre sélection. Vous pouvez aussi copier l’URL dans Add-ons.', 'Mit „In Stremio installieren“ öffnest du die App mit deiner Auswahl. Oder kopiere die URL in Add-ons.', 'Fai clic su “Installa su Stremio” per aprire l’app con la selezione. Oppure copia l’URL in Add-ons.'],
  ['Disfruta', 'Enjoy', 'Aproveite', 'Profitez-en', 'Los geht’s', 'Divertiti'],
  ['Los catálogos aparecen en Inicio y en Descubrir, y los streams al abrir cualquier película o episodio.', 'Your catalogs appear in Home and Discover; streams appear when you open a movie or episode.', 'Seus catálogos aparecem em Início e Descobrir; os streams, ao abrir um filme ou episódio.', 'Vos catalogues apparaissent dans Accueil et Découvrir ; les streams s’affichent à l’ouverture d’un film ou épisode.', 'Deine Kataloge erscheinen unter Start und Entdecken; Streams beim Öffnen eines Films oder einer Folge.', 'I cataloghi appaiono in Home e Scopri; gli stream quando apri un film o un episodio.'],
  ['¿Dudas o algo no funciona? Estamos en Discord', 'Questions or something not working? Find us on Discord', 'Dúvidas ou algo não funciona? Estamos no Discord', 'Une question ou un problème ? Retrouvez-nous sur Discord', 'Fragen oder Probleme? Wir sind auf Discord', 'Dubbi o problemi? Ci trovi su Discord'],
  ['¿Dudas o algo no funciona?', 'Questions or something not working?', 'Dúvidas ou algo não funciona?', 'Une question ou un problème ?', 'Fragen oder Probleme?', 'Dubbi o problemi?'],
  ['Escríbenos: soporte, avisos de novedades y sugerencias de catálogos, plataformas o filtros nuevos.', 'Contact us for support, updates and suggestions for new catalogs, platforms or filters.', 'Fale conosco para suporte, novidades e sugestões de catálogos, plataformas ou filtros.', 'Écrivez-nous pour obtenir de l’aide, suivre les nouveautés ou suggérer des catalogues, plateformes ou filtres.', 'Schreib uns bei Fragen, für Neuigkeiten oder Vorschläge zu Katalogen, Plattformen und Filtern.', 'Scrivici per assistenza, novità e suggerimenti su cataloghi, piattaforme o filtri.'],
  ['Abrir soporte', 'Open support', 'Abrir suporte', 'Contacter le support', 'Support öffnen', 'Apri il supporto'],
  ['Contactar con soporte', 'Contact support', 'Falar com o suporte', 'Contacter le support', 'Support kontaktieren', 'Contatta il supporto'],
  ['Soporte de la comunidad, avisos de novedades y un canal para pedir catálogos, plataformas o filtros nuevos.', 'Community support, news and a place to request new catalogs, platforms or filters.', 'Suporte da comunidade, novidades e um canal para pedir novos catálogos, plataformas ou filtros.', 'Aide communautaire, actualités et un canal pour demander de nouveaux catalogues, plateformes ou filtres.', 'Community-Support, Neuigkeiten und ein Kanal für Wünsche zu Katalogen, Plattformen oder Filtern.', 'Supporto della community, novità e un canale per richiedere nuovi cataloghi, piattaforme o filtri.'],
  ['Unirme al Discord', 'Join Discord', 'Entrar no Discord', 'Rejoindre Discord', 'Discord beitreten', 'Unisciti a Discord'],
  ['Donar', 'Donate', 'Doar', 'Faire un don', 'Spenden', 'Dona'],
  ['Donar en Ko-fi', 'Donate on Ko-fi', 'Doar no Ko-fi', 'Faire un don sur Ko-fi', 'Auf Ko-fi spenden', 'Dona su Ko-fi'],
  ['¿Te sirve Catálogos+? Invítame un café', 'Is Catálogos+ useful to you? Buy me a coffee', 'O Catálogos+ está ajudando? Me pague um café', 'Catálogos+ te rend service ? Offrez-moi un café', 'Hilft dir Catálogos+? Spendiere mir einen Kaffee', 'Ti è utile Catálogos+? Offrimi un caffè'],
  ['El addon es gratis y no tiene anuncios ni cuentas. Si te ahorra búsquedas, puedes apoyar el mantenimiento con una donación en Ko-fi: se paga con PayPal o tarjeta y Ko-fi no cobra comisión por donar.', 'The add-on is free, with no ads and no accounts. If it saves you searching, you can support the maintenance with a Ko-fi donation: pay with PayPal or card, and Ko-fi takes no fee on donations.', 'O complemento é grátis e não tem anúncios nem contas. Se ele economiza suas buscas, você pode apoiar a manutenção com uma doação no Ko-fi: o pagamento é com PayPal ou cartão e o Ko-fi não cobra comissão em doações.', 'L’extension est gratuite, sans publicité ni compte. Si elle vous fait gagner du temps, vous pouvez soutenir la maintenance avec un don Ko-fi : paiement par PayPal ou carte, et Ko-fi ne prend aucune commission sur les dons.', 'Das Add-on ist kostenlos, ohne Werbung und ohne Konten. Wenn es dir Sucherei erspart, kannst du die Pflege mit einer Ko-fi-Spende unterstützen: bezahlt wird mit PayPal oder Karte, und Ko-fi nimmt für Spenden keine Gebühr.', 'L’add-on è gratis, senza annunci né account. Se ti fa risparmiare ricerche, puoi sostenere la manutenzione con una donazione su Ko-fi: si paga con PayPal o carta e Ko-fi non trattiene commissioni sulle donazioni.'],
  ['Lo que más', 'Frequently', 'Perguntas', 'Les questions', 'Häufige', 'Le domande più'],
  ['se pregunta', 'asked questions', 'frequentes', 'fréquentes', 'Fragen', 'frequenti'],
  ['¿No está tu duda? Pregunta en el canal de soporte y te respondemos.', 'Still have a question? Ask in the support channel and we’ll help.', 'Ainda tem dúvidas? Pergunte no canal de suporte e responderemos.', 'Une autre question ? Écrivez-nous sur le canal d’assistance.', 'Noch Fragen? Frag im Support-Kanal – wir helfen dir.', 'Hai altre domande? Scrivi nel canale di supporto e ti risponderemo.'],
  ['¿Cómo oculto las copias CAM, el 3D o el 4K?', 'How do I hide CAM, 3D or 4K releases?', 'Como oculto versões CAM, 3D ou 4K?', 'Comment masquer les versions CAM, 3D ou 4K ?', 'Wie blende ich CAM-, 3D- oder 4K-Versionen aus?', 'Come nascondo le versioni CAM, 3D o 4K?'],
  ['En el', 'In the', 'No', 'Dans le', 'Im', 'Nel'],
  ['configurador', 'configurator', 'configurador', 'configurateur', 'Konfigurator', 'configuratore'],
  [', sección «Filtros de streams»: desmarca lo que no quieras ver —tipo de copia (CAM, screener, REMUX…), resolución (4K, 1080p, 720p, SD) e imagen (3D, HDR, Dolby Vision, HEVC, AV1)— y pulsa «Instalar en Stremio». Lo que desmarques no vuelve a salir en la lista de streams.', ', open “Stream filters”, uncheck what you don’t want—source (CAM, screener, REMUX…), resolution (4K, 1080p, 720p, SD) or video (3D, HDR, Dolby Vision, HEVC, AV1)—then click “Install on Stremio”. Hidden releases won’t appear in the stream list.', ', na seção “Filtros de streams”, desmarque o que não quer ver —origem (CAM, screener, REMUX…), resolução (4K, 1080p, 720p, SD) ou imagem (3D, HDR, Dolby Vision, HEVC, AV1)— e clique em “Instalar no Stremio”. As versões ocultas não aparecem na lista.', ', dans « Filtres de streams », décochez ce que vous ne voulez pas voir — source (CAM, screener, REMUX…), résolution ou image — puis cliquez sur « Installer sur Stremio ». Les versions masquées n’apparaîtront plus.', ', wähle unter „Stream-Filter“ ab, was du nicht sehen möchtest, und klicke auf „In Stremio installieren“. Ausgeblendete Releases erscheinen nicht mehr in der Streamliste.', ', in “Filtri degli stream” deseleziona ciò che non vuoi vedere e fai clic su “Installa su Stremio”. Le versioni nascoste non appariranno nella lista degli stream.'],
  ['Ya lo tengo instalado, ¿cómo cambio mi configuración?', 'I already installed it. How do I change my settings?', 'Já instalei. Como altero minhas configurações?', 'Je l’ai déjà installé. Comment modifier mes réglages ?', 'Schon installiert – wie ändere ich die Einstellungen?', 'L’ho già installato. Come cambio le impostazioni?'],
  ['En Stremio abre Addons, busca Catálogos+ y pulsa «Configurar»: se abre esta web con tu selección cargada. Cambia lo que quieras e instala de nuevo. Para Stremio cada configuración es un addon distinto, así que', 'In Stremio, open Add-ons, find Catálogos+ and choose “Configure”. This page opens with your current settings. Make changes and install again. Stremio treats each configuration as a separate add-on, so', 'No Stremio, abra Add-ons, encontre Catálogos+ e toque em “Configurar”. Esta página abrirá com suas configurações atuais. Altere o que quiser e instale novamente. Para o Stremio, cada configuração é um complemento separado, então', 'Dans Stremio, ouvrez Add-ons, trouvez Catálogos+ et choisissez « Configurer ». Cette page s’ouvre avec vos réglages. Modifiez-les puis réinstallez. Stremio considère chaque configuration comme une extension distincte, donc', 'Öffne in Stremio Add-ons, suche Catálogos+ und wähle „Konfigurieren“. Diese Seite öffnet sich mit deinen Einstellungen. Ändere sie und installiere erneut. Stremio behandelt jede Konfiguration als eigenes Add-on, daher', 'In Stremio apri Add-ons, trova Catálogos+ e scegli “Configura”. Questa pagina si aprirà con le impostazioni attuali. Modificale e installa di nuovo. Stremio considera ogni configurazione un add-on separato, quindi'],
  ['desinstala la versión anterior', 'uninstall the previous version', 'desinstale a versão anterior', 'désinstallez l’ancienne version', 'deinstalliere die vorherige Version', 'disinstalla la versione precedente'],
  ['; si no, verás los catálogos repetidos y sus streams sin filtrar.', '; otherwise, you’ll see duplicate catalogs and unfiltered streams.', '; caso contrário, os catálogos e streams aparecerão duplicados e sem filtros.', '; sinon, les catalogues et les streams non filtrés apparaîtront en double.', '; sonst erscheinen Kataloge doppelt und Streams ungefiltert.', '; altrimenti vedrai cataloghi duplicati e stream senza filtri.'],
  ['¿Por qué un título no muestra streams?', 'Why does a title have no streams?', 'Por que um título não mostra streams?', 'Pourquoi un titre n’a-t-il aucun stream ?', 'Warum werden für einen Titel keine Streams angezeigt?', 'Perché un titolo non mostra stream?'],
  ['Los streams salen de buscadores públicos de torrents: si ninguno tiene ese título, no hay resultados. Si usas filtros, puede que todas las copias que existen estén en una categoría que ocultaste (un estreno reciente que solo circula en CAM, por ejemplo); vuelve a marcarla en el configurador.', 'Streams come from public torrent search engines. If none has the title, there are no results. Filters may also hide every available release; re-enable the relevant category in the configurator.', 'Os streams vêm de buscadores públicos de torrents. Se nenhum encontrar o título, não haverá resultados. Os filtros também podem ocultar todas as versões disponíveis; reative a categoria no configurador.', 'Les streams proviennent de moteurs de recherche publics de torrents. Si aucun ne trouve le titre, aucun résultat ne s’affiche. Vos filtres peuvent aussi masquer toutes les versions disponibles ; réactivez la catégorie dans le configurateur.', 'Streams stammen aus öffentlichen Torrent-Suchmaschinen. Wird der Titel dort nicht gefunden, gibt es keine Ergebnisse. Filter können auch alle verfügbaren Releases ausblenden – aktiviere die passende Kategorie wieder.', 'Gli stream provengono da motori di ricerca pubblici di torrent. Se il titolo non viene trovato, non ci sono risultati. I filtri potrebbero nascondere tutte le versioni disponibili: riattiva la categoria nel configuratore.'],
  ['¿Qué cambian el idioma y la región?', 'What do language and region change?', 'O que idioma e região alteram?', 'Que changent la langue et la région ?', 'Was ändern Sprache und Region?', 'Cosa cambiano lingua e regione?'],
  ['El idioma decide en qué lengua llegan títulos, sinopsis y pósters (18 disponibles). La región decide qué ofrece cada plataforma en tu país y qué hay en cines (44 países). Los nombres de los catálogos se mantienen en español; esta web se adapta automáticamente al idioma de tu navegador.', 'Language controls title, summary and poster translations (18 available). Region controls platform availability and cinema listings (44 countries). Catalog names remain in Spanish; this website automatically follows your browser language.', 'O idioma define títulos, sinopses e pôsteres (18 opções). A região define a disponibilidade das plataformas e os filmes em cartaz (44 países). Os nomes dos catálogos permanecem em espanhol; este site acompanha automaticamente o idioma do navegador.', 'La langue détermine les titres, résumés et affiches (18 langues). La région détermine les plateformes disponibles et les films à l’affiche (44 pays). Les noms des catalogues restent en espagnol ; ce site suit automatiquement la langue de votre navigateur.', 'Die Sprache bestimmt Titel, Beschreibungen und Poster (18 Optionen). Die Region bestimmt Plattformangebote und Kinoprogramm (44 Länder). Katalognamen bleiben auf Spanisch; diese Website übernimmt automatisch die Browsersprache.', 'La lingua determina titoli, trame e poster (18 opzioni). La regione determina le piattaforme disponibili e i film al cinema (44 paesi). I nomi dei cataloghi restano in spagnolo; questo sito usa automaticamente la lingua del browser.'],
  ['¿Es gratis? ¿Aloja contenido?', 'Is it free? Does it host content?', 'É grátis? Hospeda conteúdo?', 'Est-ce gratuit ? Le service héberge-t-il du contenu ?', 'Ist es kostenlos? Werden Inhalte gehostet?', 'È gratis? Ospita contenuti?'],
  ['Es gratis y no pide cuenta. Catálogos+ no aloja ni distribuye archivos: organiza catálogos con datos de TMDB y enlaza resultados de buscadores públicos.', 'It’s free and requires no account. Catálogos+ does not host or distribute files; it organizes catalogs using TMDB data and links to public search results.', 'É grátis e não exige conta. Catálogos+ não hospeda nem distribui arquivos: organiza catálogos com dados do TMDB e links para resultados públicos.', 'Le service est gratuit et sans compte. Catálogos+ n’héberge ni ne distribue de fichiers : il organise des catalogues avec les données TMDB et renvoie vers des résultats publics.', 'Kostenlos und ohne Konto. Catálogos+ hostet oder verteilt keine Dateien, sondern organisiert Kataloge mit TMDB-Daten und verlinkt öffentliche Suchergebnisse.', 'È gratis e non richiede un account. Catálogos+ non ospita né distribuisce file: organizza cataloghi con dati TMDB e collega risultati pubblici.'],
  ['¿Listo para', 'Ready to', 'Pronto para', 'Prêt à', 'Bereit zum', 'Pronto per'],
  ['instalarlo?', 'install?', 'instalar?', 'installer ?', 'Installieren?', 'installarlo?'],
  ['Un clic y aparece en Stremio. O copia la URL y pégala en el buscador de la sección Addons.', 'One click adds it to Stremio. Or copy the URL and paste it into the Add-ons search box.', 'Um clique e ele aparece no Stremio. Ou copie a URL e cole na busca de Add-ons.', 'Un clic et l’extension apparaît dans Stremio. Vous pouvez aussi copier l’URL dans la recherche Add-ons.', 'Ein Klick fügt es zu Stremio hinzu. Oder kopiere die URL in die Add-ons-Suche.', 'Un clic e apparirà in Stremio. Oppure copia l’URL e incollala nella ricerca Add-ons.'],
  ['Copiar', 'Copy', 'Copiar', 'Copier', 'Kopieren', 'Copia'],
  ['Copia a mano', 'Copy manually', 'Copie manualmente', 'Copiez manuellement', 'Manuell kopieren', 'Copia manualmente'],
  ['Funciona en Stremio Web, Desktop, Android, iOS y TV.', 'Works on Stremio Web, Desktop, Android, iOS and TV.', 'Funciona no Stremio Web, Desktop, Android, iOS e TV.', 'Compatible avec Stremio Web, Desktop, Android, iOS et TV.', 'Funktioniert mit Stremio Web, Desktop, Android, iOS und TV.', 'Funziona su Stremio Web, Desktop, Android, iOS e TV.'],
  ['Addon de Stremio con catálogos por plataforma y estudio, fichas completas y streams filtrados a tu gusto. Gratis y sin cuenta.', 'A Stremio add-on with platform and studio catalogs, detailed title pages and streams filtered your way. Free, no account required.', 'Complemento do Stremio com catálogos por plataforma e estúdio, fichas completas e streams filtrados do seu jeito. Grátis e sem conta.', 'Une extension Stremio avec des catalogues par plateforme et studio, des fiches complètes et des streams filtrés à votre goût. Gratuit, sans compte.', 'Ein Stremio-Add-on mit Plattform- und Studiokatalogen, ausführlichen Titelinfos und Streams nach Wunsch. Kostenlos und ohne Konto.', 'Un add-on Stremio con cataloghi per piattaforma e studio, schede complete e stream filtrati a modo tuo. Gratis e senza account.'],
  ['Addon', 'Add-on', 'Complemento', 'Extension', 'Add-on', 'Add-on'],
  ['manifest.json', 'manifest.json', 'manifest.json', 'manifest.json', 'manifest.json', 'manifest.json'],
  ['Discord de Catálogos+', 'Catálogos+ Discord', 'Discord do Catálogos+', 'Discord de Catálogos+', 'Catálogos+ auf Discord', 'Discord di Catálogos+'],
  ['Donar con Ko-fi', 'Donate with Ko-fi', 'Doar com o Ko-fi', 'Faire un don avec Ko-fi', 'Mit Ko-fi spenden', 'Dona con Ko-fi'],
  ['Descargar Stremio', 'Download Stremio', 'Baixar Stremio', 'Télécharger Stremio', 'Stremio herunterladen', 'Scarica Stremio'],
  ['Estado del servicio', 'Service status', 'Status do serviço', 'État du service', 'Dienststatus', 'Stato del servizio'],
  ['Datos', 'Data', 'Dados', 'Données', 'Daten', 'Dati'],
  ['Catálogos+ · Datos cortesía de TMDB, JustWatch, TVMaze, OMDB, TheTVDB y Watchmode. Este producto usa la API de TMDB pero no está respaldado ni certificado por TMDB. Los logos son propiedad de sus respectivos servicios. No aloja ni distribuye contenido; solo organiza catálogos y enlaza fuentes públicas.', 'Catálogos+ · Data courtesy of TMDB, JustWatch, TVMaze, OMDB, TheTVDB and Watchmode. This product uses the TMDB API but is not endorsed or certified by TMDB. Logos belong to their respective services. No content is hosted or distributed; the site organizes catalogs and links to public sources.', 'Catálogos+ · Dados fornecidos por TMDB, JustWatch, TVMaze, OMDB, TheTVDB e Watchmode. Este produto usa a API do TMDB, mas não é endossado nem certificado pelo TMDB. Os logotipos pertencem aos respectivos serviços. Nenhum conteúdo é hospedado ou distribuído; o site organiza catálogos e links para fontes públicas.', 'Catálogos+ · Données fournies par TMDB, JustWatch, TVMaze, OMDB, TheTVDB et Watchmode. Ce produit utilise l’API TMDB sans être approuvé ni certifié par TMDB. Les logos appartiennent à leurs services. Aucun contenu n’est hébergé ou distribué ; le site organise des catalogues et renvoie vers des sources publiques.', 'Catálogos+ · Daten von TMDB, JustWatch, TVMaze, OMDB, TheTVDB und Watchmode. Dieses Produkt nutzt die TMDB-API, wird aber nicht von TMDB unterstützt oder zertifiziert. Logos gehören den jeweiligen Diensten. Es werden keine Inhalte gehostet oder verbreitet; die Website organisiert Kataloge und verlinkt öffentliche Quellen.', 'Catálogos+ · Dati forniti da TMDB, JustWatch, TVMaze, OMDB, TheTVDB e Watchmode. Questo prodotto usa l’API TMDB ma non è approvato né certificato da TMDB. I loghi appartengono ai rispettivi servizi. Non ospita né distribuisce contenuti: organizza cataloghi e collega fonti pubbliche.'],

  // /configure introduction and navigation.
  ['Configura tu addon de Stremio', 'Configure your Stremio add-on', 'Configure seu complemento do Stremio', 'Configurez votre extension Stremio', 'Konfiguriere dein Stremio-Add-on', 'Configura il tuo add-on Stremio'],
  ['Secciones del configurador', 'Configurator sections', 'Seções do configurador', 'Sections du configurateur', 'Konfiguratorbereiche', 'Sezioni del configuratore'],
  ['Elige idioma y región, las plataformas y estudios que quieres ver y qué streams prefieres. Todo es opcional: lo que no toques se queda como viene. Al terminar, pulsa «Instalar en Stremio».', 'Choose your language and region, platforms and studios, and the streams you prefer. Everything is optional; untouched settings stay at their defaults. When you’re done, click “Install on Stremio”.', 'Escolha idioma e região, plataformas e estúdios, e os streams que prefere. Tudo é opcional: o que não alterar permanece como está. Ao terminar, clique em “Instalar no Stremio”.', 'Choisissez la langue, la région, les plateformes, les studios et les streams souhaités. Tout est facultatif : les options non modifiées gardent leur valeur par défaut. Cliquez ensuite sur « Installer sur Stremio ».', 'Wähle Sprache, Region, Plattformen, Studios und bevorzugte Streams. Alles ist optional; unveränderte Einstellungen bleiben bestehen. Klicke zum Abschluss auf „In Stremio installieren“.', 'Scegli lingua e regione, piattaforme e studi, e gli stream che preferisci. Tutto è facoltativo: le opzioni non modificate restano predefinite. Al termine fai clic su “Installa su Stremio”.'],
  ['El idioma cambia títulos, sinopsis y pósters. La región decide qué ofrece cada plataforma en tu país y qué hay en cines.', 'Language changes titles, summaries and posters. Region determines what each platform offers in your country and what’s in cinemas.', 'O idioma altera títulos, sinopses e pôsteres. A região determina o que cada plataforma oferece no seu país e o que está em cartaz.', 'La langue modifie les titres, résumés et affiches. La région détermine l’offre des plateformes et les films à l’affiche.', 'Die Sprache ändert Titel, Zusammenfassungen und Poster. Die Region bestimmt das Plattformangebot und das Kinoprogramm.', 'La lingua cambia titoli, trame e poster. La regione determina l’offerta delle piattaforme e i film al cinema.'],
  ['Idioma', 'Language', 'Idioma', 'Langue', 'Sprache', 'Lingua'],
  ['Región de plataformas', 'Platform region', 'Região das plataformas', 'Région des plateformes', 'Plattformregion', 'Regione delle piattaforme'],
  ['Árabe', 'Arabic', 'Árabe', 'Arabe', 'Arabisch', 'Arabo'],
  ['Ruso', 'Russian', 'Russo', 'Russe', 'Russisch', 'Russo'],
  ['Japonés', 'Japanese', 'Japonês', 'Japonais', 'Japanisch', 'Giapponese'],
  ['Coreano', 'Korean', 'Coreano', 'Coréen', 'Koreanisch', 'Coreano'],
  ['Chino', 'Chinese', 'Chinês', 'Chinois', 'Chinesisch', 'Cinese'],
  ['Buscar idioma…', 'Search languages…', 'Buscar idioma…', 'Rechercher une langue…', 'Sprache suchen…', 'Cerca lingua…'],
  ['Buscar país…', 'Search country…', 'Buscar país…', 'Rechercher un pays…', 'Land suchen…', 'Cerca paese…'],
  ['Ningún idioma coincide.', 'No matching languages.', 'Nenhum idioma encontrado.', 'Aucune langue correspondante.', 'Keine passende Sprache gefunden.', 'Nessuna lingua corrispondente.'],
  ['Ningún país coincide.', 'No matching countries.', 'Nenhum país encontrado.', 'Aucun pays correspondant.', 'Kein passendes Land gefunden.', 'Nessun paese corrispondente.'],
  ['Latinoamérica', 'Latin America', 'América Latina', 'Amérique latine', 'Lateinamerika', 'America Latina'],
  ['Norteamérica', 'North America', 'América do Norte', 'Amérique du Nord', 'Nordamerika', 'Nord America'],
  ['Europa', 'Europe', 'Europa', 'Europe', 'Europa', 'Europa'],
  ['Asia y Oceanía', 'Asia and Oceania', 'Ásia e Oceania', 'Asie et Océanie', 'Asien und Ozeanien', 'Asia e Oceania'],
  ['Marca las que quieres tener en Stremio. Cada una crea una fila de películas y otra de series.', 'Select the services you want in Stremio. Each one adds a movie row and a series row.', 'Marque os serviços que quer no Stremio. Cada um cria uma linha de filmes e outra de séries.', 'Sélectionnez les services souhaités dans Stremio. Chacun ajoute une ligne de films et une de séries.', 'Wähle die Dienste für Stremio aus. Jeder erhält eine Film- und eine Serienzeile.', 'Seleziona i servizi che vuoi in Stremio. Ognuno aggiunge una riga di film e una di serie.'],
  ['Marcar todas', 'Select all', 'Marcar todas', 'Tout sélectionner', 'Alle auswählen', 'Seleziona tutte'],
  ['Desmarcar todas', 'Clear all', 'Desmarcar todas', 'Tout désélectionner', 'Alle abwählen', 'Deseleziona tutte'],
  ['Marcar todos', 'Select all', 'Marcar todos', 'Tout sélectionner', 'Alle auswählen', 'Seleziona tutti'],
  ['Desmarcar todos', 'Clear all', 'Desmarcar todos', 'Tout désélectionner', 'Alle abwählen', 'Deseleziona tutti'],
  ['Esenciales (carga rápida)', 'Essentials (fast load)', 'Essenciais (carga rápida)', 'Essentiels (rapide)', 'Basisauswahl (schnell)', 'Essenziali (rapido)'],
  ['Películas y series de cada productora.', 'Movies and series from each studio.', 'Filmes e séries de cada estúdio.', 'Films et séries de chaque studio.', 'Filme und Serien aus jedem Studio.', 'Film e serie di ogni studio.'],
  ['Las colecciones generales: tendencias, estrenos, anime…', 'General collections: trending, new releases, anime…', 'Coleções gerais: em alta, lançamentos, anime…', 'Collections générales : tendances, nouveautés, anime…', 'Allgemeine Sammlungen: Trends, Neuerscheinungen, Anime…', 'Raccolte generali: tendenze, novità, anime…'],
  ['Buscadores públicos de torrents que se consultan a la vez al abrir una película o un episodio. Sin claves ni cuentas.', 'Public torrent search engines queried together when you open a movie or episode. No keys or accounts needed.', 'Buscadores públicos de torrents consultados juntos ao abrir um filme ou episódio. Sem chaves nem contas.', 'Moteurs publics de recherche de torrents interrogés ensemble à l’ouverture d’un film ou épisode. Sans clé ni compte.', 'Öffentliche Torrent-Suchmaschinen, die beim Öffnen eines Films oder einer Folge parallel abgefragt werden. Keine Schlüssel oder Konten nötig.', 'Motori pubblici di ricerca torrent consultati insieme quando apri un film o un episodio. Nessuna chiave o account.'],
  ['Knaben, Torlock, BlackHoleBay y The RarBg son indexadores generales. Nyaa se consulta solo para anime y producciones asiáticas, YTS solo para películas y EZTV solo para series.', 'Knaben, Torlock, BlackHoleBay and The RarBg are general indexers. Nyaa is used for anime and Asian productions, YTS for movies only and EZTV for series only.', 'Knaben, Torlock, BlackHoleBay e The RarBg são indexadores gerais. Nyaa é usado para anime e produções asiáticas; YTS, apenas para filmes; EZTV, apenas para séries.', 'Knaben, Torlock, BlackHoleBay et The RarBg sont des indexeurs généralistes. Nyaa est réservé à l’anime et aux productions asiatiques, YTS aux films et EZTV aux séries.', 'Knaben, Torlock, BlackHoleBay und The RarBg sind allgemeine Indexer. Nyaa wird für Anime und asiatische Produktionen, YTS nur für Filme und EZTV nur für Serien verwendet.', 'Knaben, Torlock, BlackHoleBay e The RarBg sono indicizzatori generali. Nyaa è usato per anime e produzioni asiatiche, YTS solo per i film ed EZTV solo per le serie.'],
  ['Opcional', 'Optional', 'Opcional', 'Facultatif', 'Optional', 'Opzionale'],
  ['Conecta TorBox, EasyDebrid, Premiumize o Real-Debrid. Los magnets públicos siguen disponibles como alternativa.', 'Connect TorBox, EasyDebrid, Premiumize or Real-Debrid. Public torrent links remain available as a fallback.', 'Conecte TorBox, EasyDebrid, Premiumize ou Real-Debrid. Os links públicos de torrent continuam disponíveis como alternativa.', 'Connectez TorBox, EasyDebrid, Premiumize ou Real-Debrid. Les liens publics de torrents restent disponibles en alternative.', 'Verbinde TorBox, EasyDebrid, Premiumize oder Real-Debrid. Öffentliche Torrent-Links bleiben als Alternative verfügbar.', 'Collega TorBox, EasyDebrid, Premiumize o Real-Debrid. I link torrent pubblici restano disponibili come alternativa.'],
  ['Proveedor', 'Provider', 'Provedor', 'Fournisseur', 'Anbieter', 'Provider'],
  ['Clave API del proveedor', 'Provider API key', 'Chave API do provedor', 'Clé API du fournisseur', 'API-Schlüssel des Anbieters', 'Chiave API del provider'],
  ['Pega aquí tu clave API', 'Paste your API key here', 'Cole sua chave API aqui', 'Collez votre clé API ici', 'API-Schlüssel hier einfügen', 'Incolla qui la chiave API'],
  ['Validar y conectar', 'Validate and connect', 'Validar e conectar', 'Vérifier et connecter', 'Prüfen und verbinden', 'Verifica e collega'],
  ['Autorizar con Real-Debrid', 'Authorize with Real-Debrid', 'Autorizar com Real-Debrid', 'Autoriser avec Real-Debrid', 'Mit Real-Debrid autorisieren', 'Autorizza con Real-Debrid'],
  ['Desconectar', 'Disconnect', 'Desconectar', 'Déconnecter', 'Trennen', 'Disconnetti'],
  ['Las claves API se validan en el servidor y se guardan cifradas; nunca se guardan en el navegador ni en la URL. Real-Debrid usa OAuth y no pide pegar su token privado. El manifest solo contiene un identificador opaco: no compartas tu URL personal.', 'API keys are validated by the server and stored encrypted; they are never saved in your browser or URL. Real-Debrid uses OAuth, so you never paste its private token. The manifest contains only an opaque ID: do not share your personal URL.', 'As chaves API são validadas no servidor e armazenadas criptografadas; nunca ficam no navegador nem na URL. O Real-Debrid usa OAuth, sem colar token privado. O manifest contém apenas um ID opaco: não compartilhe sua URL pessoal.', 'Les clés API sont vérifiées par le serveur et stockées chiffrées ; elles ne sont jamais conservées dans le navigateur ni dans l’URL. Real-Debrid utilise OAuth. Le manifest ne contient qu’un identifiant opaque : ne partagez pas votre URL personnelle.', 'API-Schlüssel werden serverseitig geprüft und verschlüsselt gespeichert, niemals im Browser oder in der URL. Real-Debrid verwendet OAuth; ein privater Token muss nicht eingefügt werden. Das Manifest enthält nur eine undurchsichtige ID: Teile deine persönliche URL nicht.', 'Le chiavi API vengono verificate dal server e salvate cifrate; non restano nel browser né nell’URL. Real-Debrid usa OAuth, senza incollare token privati. Il manifest contiene solo un ID opaco: non condividere il tuo URL personale.'],
  ['TorBox comprueba la caché y crea el elemento solo con', 'TorBox checks its cache and adds an item only with', 'O TorBox verifica o cache e adiciona o item somente com', 'TorBox vérifie son cache et ajoute un élément uniquement avec', 'TorBox prüft den Cache und fügt Elemente nur mit', 'TorBox controlla la cache e aggiunge l’elemento solo con'],
  ['; el hit puede quedar en tu cuenta. EasyDebrid consulta sus archivos cacheados. Premiumize usa una comprobación best-effort y generar enlaces directos puede consumir fair-use. Real-Debrid solo resuelve torrents descargados que ya están en tu biblioteca personal: no consulta la caché global ni añade torrents.', '; the cached item may remain in your account. EasyDebrid checks cached files. Premiumize uses a best-effort cache check, and direct links may consume fair-use. Real-Debrid only resolves downloaded torrents already in your personal library; it does not query global cache or add torrents.', '; o item em cache pode ficar na sua conta. EasyDebrid consulta arquivos em cache. O Premiumize faz uma verificação best-effort, e links diretos podem consumir fair-use. O Real-Debrid só resolve torrents baixados que já estão na sua biblioteca pessoal; não consulta o cache global nem adiciona torrents.', '; l’élément en cache peut rester dans votre compte. EasyDebrid vérifie les fichiers en cache. Premiumize effectue une vérification indicative et les liens directs peuvent consommer le fair-use. Real-Debrid ne résout que les torrents téléchargés déjà dans votre bibliothèque personnelle ; il ne consulte pas le cache global et n’ajoute aucun torrent.', '; das gecachte Element kann in deinem Konto bleiben. EasyDebrid prüft gecachte Dateien. Premiumize prüft den Cache unverbindlich; Direktlinks können Fair-Use verbrauchen. Real-Debrid löst nur bereits heruntergeladene Torrents aus deiner persönlichen Bibliothek auf und fragt weder den globalen Cache ab noch fügt Torrents hinzu.', '; l’elemento in cache può restare nel tuo account. EasyDebrid verifica i file in cache. Premiumize effettua un controllo best-effort e i link diretti possono consumare fair-use. Real-Debrid risolve solo torrent già scaricati nella tua libreria personale: non consulta la cache globale né aggiunge torrent.'],
  ['Marcado = se muestra. Lo que desmarques deja de aparecer en la lista de streams de Stremio.', 'Checked = shown. Uncheck an option to hide it from Stremio’s stream list.', 'Marcado = exibido. Desmarque uma opção para ocultá-la da lista de streams do Stremio.', 'Coché = affiché. Décochez une option pour la masquer de la liste des streams Stremio.', 'Markiert = sichtbar. Deaktiviere eine Option, um sie aus Stremios Streamliste auszublenden.', 'Selezionato = visibile. Deseleziona un’opzione per nasconderla dalla lista degli stream di Stremio.'],
  ['Recomendado: sin CAM, screener ni 3D', 'Recommended: no CAM, screeners or 3D', 'Recomendado: sem CAM, screener ou 3D', 'Recommandé : sans CAM, screener ni 3D', 'Empfohlen: keine CAM-, Screener- oder 3D-Releases', 'Consigliato: niente CAM, screener o 3D'],
  ['Mostrar todo', 'Show all', 'Mostrar tudo', 'Tout afficher', 'Alles anzeigen', 'Mostra tutto'],
  ['Tipo de copia', 'Source type', 'Tipo de cópia', 'Type de source', 'Quelltyp', 'Tipo di copia'],
  ['HDTV · DVD · otras', 'HDTV · DVD · others', 'HDTV · DVD · outros', 'HDTV · DVD · autres', 'HDTV · DVD · sonstige', 'HDTV · DVD · altri'],
  ['Bajadas de plataformas de streaming', 'Rips from streaming platforms', 'Rip de plataformas de streaming', 'Captures de plateformes de streaming', 'Rips von Streaming-Plattformen', 'Rips dalle piattaforme streaming'],
  ['BluRay, BDRip y BRRip ya comprimidos', 'Compressed BluRay, BDRip and BRRip releases', 'BluRay, BDRip e BRRip já comprimidos', 'BluRay, BDRip et BRRip déjà compressés', 'Komprimierte BluRay-, BDRip- und BRRip-Releases', 'BluRay, BDRip e BRRip già compressi'],
  ['Blu-ray sin comprimir: 20–80 GB', 'Uncompressed Blu-ray: 20–80 GB', 'Blu-ray sem compressão: 20–80 GB', 'Blu-ray non compressé : 20–80 Go', 'Unkomprimierte Blu-rays: 20–80 GB', 'Blu-ray non compresso: 20–80 GB'],
  ['TV, DVD, HDRip y copias sin indicar', 'TV, DVD, HDRip and unlabelled releases', 'TV, DVD, HDRip e cópias sem indicação', 'TV, DVD, HDRip et sources non précisées', 'TV, DVD, HDRip und nicht gekennzeichnete Kopien', 'TV, DVD, HDRip e copie non specificate'],
  ['Copias de promoción: SCR, DVDScr', 'Promotional screeners: SCR, DVDScr', 'Cópias promocionais: SCR, DVDScr', 'Copies promotionnelles : SCR, DVDScr', 'Promotionskopien: SCR, DVDScr', 'Copie promozionali: SCR, DVDScr'],
  ['Grabadas en el cine: CAM, TeleSync', 'Recorded in cinemas: CAM, TeleSync', 'Gravadas no cinema: CAM, TeleSync', 'Enregistrées au cinéma : CAM, TeleSync', 'Im Kino aufgenommen: CAM, TeleSync', 'Registrate al cinema: CAM, TeleSync'],
  ['Resolución', 'Resolution', 'Resolução', 'Résolution', 'Auflösung', 'Risoluzione'],
  ['Ultra HD', 'Ultra HD', 'Ultra HD', 'Ultra HD', 'Ultra HD', 'Ultra HD'],
  ['Full HD', 'Full HD', 'Full HD', 'Full HD', 'Full HD', 'Full HD'],
  ['HD', 'HD', 'HD', 'HD', 'HD', 'HD'],
  ['480p, 576p y DVD', '480p, 576p and DVD', '480p, 576p e DVD', '480p, 576p et DVD', '480p, 576p und DVD', '480p, 576p e DVD'],
  ['Sin indicar', 'Unspecified', 'Não especificado', 'Non précisé', 'Nicht angegeben', 'Non specificato'],
  ['El nombre no dice la resolución', 'Resolution not stated in the filename', 'O nome não informa a resolução', 'La résolution n’est pas indiquée dans le nom', 'Auflösung im Dateinamen nicht angegeben', 'Risoluzione non indicata nel nome'],
  ['Imagen y códec', 'Video and codec', 'Imagem e codec', 'Image et codec', 'Video und Codec', 'Video e codec'],
  ['SBS / Over-Under: imagen doble en pantallas normales', 'SBS / Over-Under: double image on standard screens', 'SBS / Over-Under: imagem dupla em telas comuns', 'SBS / Over-Under : double image sur écran standard', 'SBS / Over-Under: Doppelbild auf normalen Bildschirmen', 'SBS / Over-Under: doppia immagine sugli schermi normali'],
  ['HDR10, HDR10+, HLG', 'HDR10, HDR10+, HLG', 'HDR10, HDR10+, HLG', 'HDR10, HDR10+, HLG', 'HDR10, HDR10+, HLG', 'HDR10, HDR10+, HLG'],
  ['Colores raros si tu pantalla no lo admite', 'Colors may look wrong if your display doesn’t support it', 'As cores podem ficar estranhas se a tela não for compatível', 'Les couleurs peuvent être altérées si votre écran n’est pas compatible', 'Farben können falsch wirken, wenn dein Bildschirm es nicht unterstützt', 'Colori anomali se lo schermo non lo supporta'],
  ['H.265: algunos equipos antiguos no lo abren', 'H.265: some older devices cannot play it', 'H.265: alguns aparelhos antigos não reproduzem', 'H.265 : certains appareils anciens ne le lisent pas', 'H.265: auf manchen älteren Geräten nicht abspielbar', 'H.265: alcuni dispositivi meno recenti non lo riproducono'],
  ['Códec nuevo: pide hardware reciente', 'New codec: requires recent hardware', 'Codec novo: requer hardware recente', 'Nouveau codec : nécessite un matériel récent', 'Neuer Codec: benötigt aktuelle Hardware', 'Nuovo codec: richiede hardware recente'],
  ['Un stream se oculta si entra en', 'A stream is hidden if it matches', 'Um stream é ocultado se corresponder a', 'Un stream est masqué s’il correspond à', 'Ein Stream wird ausgeblendet, wenn er', 'Uno stream viene nascosto se rientra in'],
  ['cualquiera', 'any', 'qualquer', 'l’une', 'einer', 'una qualsiasi'],
  ['de las categorías desmarcadas: con «3D» desmarcado desaparece un 3D aunque sea 1080p. La categoría sale del nombre del archivo, así que una copia mal etiquetada puede colarse.', 'of the unchecked categories. For example, unchecking “3D” hides a 3D release even at 1080p. Categories are inferred from filenames, so mislabeled releases may slip through.', 'das categorias desmarcadas. Por exemplo, desmarcar “3D” oculta uma versão 3D mesmo em 1080p. As categorias são identificadas pelo nome do arquivo; uma cópia mal rotulada pode passar.', 'aux catégories décochées. Par exemple, décocher « 3D » masque une version 3D même en 1080p. Les catégories sont déduites du nom de fichier ; une copie mal étiquetée peut passer.', 'einer abgewählten Kategorie entspricht. „3D“ blendet etwa auch eine 1080p-3D-Version aus. Kategorien werden aus Dateinamen erkannt; falsch markierte Kopien können durchrutschen.', 'alle categorie deselezionate. Per esempio, deselezionare “3D” nasconde una versione 3D anche in 1080p. Le categorie si deducono dal nome del file, quindi una copia etichettata male può sfuggire.'],
  ['Orden', 'Sort order', 'Ordenação', 'Trier par', 'Sortierung', 'Ordina per'],
  ['Más seeders', 'Most seeders', 'Mais seeders', 'Plus de seeders', 'Meiste Seeders', 'Più seeders'],
  ['Los que mejor cargan primero', 'Best availability first', 'Mais disponíveis primeiro', 'Les plus disponibles en premier', 'Beste Verfügbarkeit zuerst', 'Prima i più disponibili'],
  ['Mejor calidad', 'Best quality', 'Melhor qualidade', 'Meilleure qualité', 'Beste Qualität', 'Qualità migliore'],
  ['De 4K a SD; CAM y screeners al final', 'From 4K to SD; CAM and screeners last', 'De 4K a SD; CAM e screeners por último', 'De 4K à SD ; CAM et screeners à la fin', 'Von 4K bis SD; CAM und Screeners zuletzt', 'Da 4K a SD; CAM e screener in fondo'],
  ['Menor tamaño', 'Smallest size', 'Menor tamanho', 'Taille minimale', 'Kleinste Größe', 'Dimensione minore'],
  ['Los más ligeros primero', 'Smallest files first', 'Arquivos menores primeiro', 'Les fichiers les plus légers d’abord', 'Kleinste Dateien zuerst', 'Prima i file più leggeri'],
  ['Tamaño máximo', 'Maximum size', 'Tamanho máximo', 'Taille maximale', 'Maximale Größe', 'Dimensione massima'],
  ['Sin límite', 'No limit', 'Sem limite', 'Sans limite', 'Kein Limit', 'Senza limite'],
  ['Cuenta el torrent entero: un pack con la temporada completa pesa mucho más que un episodio suelto.', 'This counts the entire torrent: a full-season pack is much larger than a single episode.', 'Conta o torrent inteiro: um pacote da temporada completa é bem maior que um episódio.', 'La taille concerne tout le torrent : un pack de saison complète pèse bien plus qu’un épisode.', 'Gezählt wird der gesamte Torrent: Ein Staffelpaket ist deutlich größer als eine einzelne Folge.', 'Conta l’intero torrent: un pacchetto di stagione pesa molto più di un singolo episodio.'],
  ['Al instalar se crea una URL personal con tu selección.', 'Installing creates a personal URL with your settings.', 'A instalação cria uma URL pessoal com suas escolhas.', 'L’installation crée une URL personnelle avec vos réglages.', 'Bei der Installation wird eine persönliche URL mit deiner Auswahl erstellt.', 'L’installazione crea un URL personale con le tue scelte.'],
  ['Si ya tenías Catálogos+ instalado, desinstala la versión anterior', 'If Catálogos+ is already installed, uninstall the previous version', 'Se já tinha Catálogos+ instalado, desinstale a versão anterior', 'Si Catálogos+ est déjà installé, désinstallez l’ancienne version', 'Wenn Catálogos+ bereits installiert ist, deinstalliere die vorherige Version', 'Se Catálogos+ è già installato, disinstalla la versione precedente'],
  ['en Stremio (Addons): para Stremio cada configuración es un addon distinto, y la antigua seguiría mostrando sus catálogos y sus streams sin filtrar.', 'in Stremio (Add-ons). Stremio treats each configuration as a separate add-on, so the old one would keep showing its catalogs and unfiltered streams.', 'no Stremio (Add-ons): cada configuração é um complemento separado e o antigo continuaria mostrando catálogos e streams sem filtros.', 'dans Stremio (Add-ons) : chaque configuration est une extension distincte ; l’ancienne continuerait d’afficher ses catalogues et ses streams non filtrés.', 'in Stremio (Add-ons): Jede Konfiguration ist ein eigenes Add-on; die alte Version würde ihre Kataloge und ungefilterten Streams weiter anzeigen.', 'in Stremio (Add-ons): ogni configurazione è un add-on distinto; la vecchia continuerebbe a mostrare cataloghi e stream senza filtri.'],
  ['Calculando…', 'Calculating…', 'Calculando…', 'Calcul…', 'Wird berechnet…', 'Calcolo…'],
  ['Restablecer', 'Reset', 'Redefinir', 'Réinitialiser', 'Zurücksetzen', 'Reimposta'],
  ['Copiar URL', 'Copy URL', 'Copiar URL', 'Copier l’URL', 'URL kopieren', 'Copia URL'],
  ['Copiada', 'Copied', 'Copiada', 'Copiée', 'Kopiert', 'Copiata'],
  ['No se pudo copiar', 'Could not copy', 'Não foi possível copiar', 'Impossible de copier', 'Kopieren fehlgeschlagen', 'Impossibile copiare'],
  ['Copiar la URL del manifest', 'Copy the manifest URL', 'Copiar a URL do manifest', 'Copier l’URL du manifest', 'Manifest-URL kopieren', 'Copia l’URL del manifest'],
  ['Volver a los valores de serie', 'Restore defaults', 'Restaurar padrões', 'Rétablir les valeurs par défaut', 'Standardeinstellungen wiederherstellen', 'Ripristina i valori predefiniti'],

  // Remaining interface labels, help text and dynamic content fragments.
  ['Elegir catálogos', 'Choose catalogs', 'Escolher catálogos', 'Choisir des catalogues', 'Kataloge auswählen', 'Scegli cataloghi'],
  ['Anime · Popular', 'Anime · Popular', 'Anime · Popular', 'Anime · Populaire', 'Anime · Beliebt', 'Anime · Popolare'],
  ['Películas · En cines', 'Movies · In cinemas', 'Filmes · Em cartaz', 'Films · À l’affiche', 'Filme · Im Kino', 'Film · Al cinema'],
  ['Películas · Próximos estrenos', 'Movies · Upcoming releases', 'Filmes · Próximos lançamentos', 'Films · Prochaines sorties', 'Filme · Demnächst', 'Film · Prossime uscite'],
  ['Series · En TV hoy (TVMaze)', 'Series · On TV today (TVMaze)', 'Séries · Na TV hoje (TVMaze)', 'Séries · À la TV aujourd’hui (TVMaze)', 'Serien · Heute im TV (TVMaze)', 'Serie · In TV oggi (TVMaze)'],
  ['Series · En emisión', 'Series · Currently airing', 'Séries · Em exibição', 'Séries · En cours', 'Serien · Läuft gerade', 'Serie · In onda'],
  ['Series · Por género y miniseries', 'Series · By genre and miniseries', 'Séries · Por gênero e minisséries', 'Séries · Par genre et mini-séries', 'Serien · Nach Genre und Miniserien', 'Serie · Per genere e miniserie'],
  ['Populares', 'Popular', 'Populares', 'Populaires', 'Beliebt', 'Popolari'],
  ['Top Valoradas', 'Top Rated', 'Mais bem avaliadas', 'Les mieux notés', 'Bestbewertet', 'Più votati'],
  ['películas esta semana', 'movies this week', 'filmes nesta semana', 'films cette semaine', 'Filme diese Woche', 'film questa settimana'],
  ['series esta semana', 'series this week', 'séries nesta semana', 'séries cette semaine', 'Serien diese Woche', 'serie questa settimana'],
  ['Anime popular', 'Popular anime', 'Anime popular', 'Anime populaire', 'Beliebte Anime', 'Anime popolari'],
  ['Títulos de películas y series', 'Movie and series titles', 'Títulos de filmes e séries', 'Titres de films et séries', 'Film- und Serientitel', 'Titoli di film e serie'],
  ['Catálogos+ · Configura tu addon de Stremio', 'Catálogos+ · Configure your Stremio add-on', 'Catálogos+ · Configure seu complemento do Stremio', 'Catálogos+ · Configurez votre extension Stremio', 'Catálogos+ · Konfiguriere dein Stremio-Add-on', 'Catálogos+ · Configura il tuo add-on Stremio'],
  ['Configura Catálogos+ para Stremio: idioma, región, plataformas, estudios, proveedores y filtros de streams (oculta CAM, 3D, 4K…). Instálalo con un clic.', 'Configure Catálogos+ for Stremio: language, region, platforms, studios, providers and stream filters (hide CAM, 3D, 4K…). Install in one click.', 'Configure o Catálogos+ para o Stremio: idioma, região, plataformas, estúdios, provedores e filtros de streams (oculte CAM, 3D, 4K…). Instale com um clique.', 'Configurez Catálogos+ pour Stremio : langue, région, plateformes, studios, fournisseurs et filtres de streams (masquez CAM, 3D, 4K…). Installez en un clic.', 'Konfiguriere Catálogos+ für Stremio: Sprache, Region, Plattformen, Studios, Anbieter und Stream-Filter (CAM, 3D, 4K ausblenden…). Mit einem Klick installieren.', 'Configura Catálogos+ per Stremio: lingua, regione, piattaforme, studi, provider e filtri degli stream (nascondi CAM, 3D, 4K…). Installa con un clic.'],
  ['Catálogos+ · Addon de Stremio', 'Catálogos+ · Stremio add-on', 'Catálogos+ · Complemento do Stremio', 'Catálogos+ · Extension Stremio', 'Catálogos+ · Stremio-Add-on', 'Catálogos+ · Add-on Stremio'],
  ['Catálogos+ · Addon de Stremio — Películas y series por plataforma y estudio', 'Catálogos+ · Stremio add-on — Movies and series by platform and studio', 'Catálogos+ · Complemento do Stremio — Filmes e séries por plataforma e estúdio', 'Catálogos+ · Extension Stremio — Films et séries par plateforme et studio', 'Catálogos+ · Stremio-Add-on — Filme und Serien nach Plattform und Studio', 'Catálogos+ · Add-on Stremio — Film e serie per piattaforma e studio'],
  ['La web se adapta automáticamente a tu idioma preferido.', 'The website automatically adapts to your preferred language.', 'O site se adapta automaticamente ao idioma preferido.', 'Le site s’adapte automatiquement à votre langue préférée.', 'Die Website passt sich automatisch an deine bevorzugte Sprache an.', 'Il sito si adatta automaticamente alla lingua preferita.'],
  ['Catálogos+, inicio', 'Catálogos+, home', 'Catálogos+, início', 'Catálogos+, accueil', 'Catálogos+, Startseite', 'Catálogos+, home'],
  ['Soporte en Discord', 'Discord support', 'Suporte no Discord', 'Assistance sur Discord', 'Support auf Discord', 'Supporto su Discord'],
  ['Películas en tendencia esta semana', 'Trending movies this week', 'Filmes em alta nesta semana', 'Films tendance cette semaine', 'Filmtrends diese Woche', 'Film di tendenza questa settimana'],
  ['Series en tendencia esta semana', 'Trending series this week', 'Séries em alta nesta semana', 'Séries tendance cette semaine', 'Serientrends diese Woche', 'Serie di tendenza questa settimana'],
  ['Tendencias películas esta semana', 'Trending movies this week', 'Filmes em alta nesta semana', 'Tendances des films cette semaine', 'Filmtrends diese Woche', 'Tendenze film di questa settimana'],
  ['Tendencias series esta semana', 'Trending series this week', 'Séries em alta nesta semana', 'Tendances des séries cette semaine', 'Serientrends diese Woche', 'Tendenze serie di questa settimana'],
  ['Tipo de contenido', 'Content type', 'Tipo de conteúdo', 'Type de contenu', 'Inhaltstyp', 'Tipo di contenuto'],
  ['Buscar idioma', 'Search languages', 'Buscar idioma', 'Rechercher des langues', 'Sprachen suchen', 'Cerca lingue'],
  ['Buscar país', 'Search countries', 'Buscar países', 'Rechercher des pays', 'Länder suchen', 'Cerca paesi'],
  ['Proveedor debrid', 'Debrid provider', 'Provedor de debrid', 'Fournisseur de debrid', 'Debrid-Anbieter', 'Provider debrid'],
  ['Instalación', 'Installation', 'Instalação', 'Installation', 'Installation', 'Installazione'],
  ['Oculta: Screener, CAM · TS, 3D', 'Hidden: Screener, CAM · TS, 3D', 'Ocultos: Screener, CAM · TS, 3D', 'Masqués : Screener, CAM · TS, 3D', 'Ausgeblendet: Screener, CAM · TS, 3D', 'Nascosti: Screener, CAM · TS, 3D'],
  ['El idioma de los catálogos controla títulos, sinopsis y pósters; esta web se adapta automáticamente al idioma de tu navegador.', 'Catalog language controls titles, summaries and posters; this website automatically follows your browser language.', 'O idioma dos catálogos controla títulos, sinopses e pôsteres; este site acompanha automaticamente o idioma do navegador.', 'La langue des catalogues détermine les titres, résumés et affiches ; ce site suit automatiquement la langue de votre navigateur.', 'Die Katalogsprache bestimmt Titel, Zusammenfassungen und Poster; diese Website übernimmt automatisch die Browsersprache.', 'La lingua dei cataloghi determina titoli, trame e poster; questo sito usa automaticamente la lingua del browser.'],
  ['Los nombres de los catálogos se mantienen en español; esta web se adapta automáticamente al idioma de tu navegador.', 'Catalog names remain in Spanish; this website automatically follows your browser language.', 'Os nomes dos catálogos permanecem em espanhol; este site acompanha automaticamente o idioma do navegador.', 'Les noms des catalogues restent en espagnol ; ce site suit automatiquement la langue de votre navigateur.', 'Katalognamen bleiben auf Spanisch; diese Website übernimmt automatisch die Browsersprache.', 'I nomi dei cataloghi restano in spagnolo; questo sito usa automaticamente la lingua del browser.'],
  ['Si una plataforma no tiene catálogo en tu país, el addon usa', 'If a platform has no catalog in your country, the add-on uses', 'Se uma plataforma não tiver catálogo no seu país, o complemento usa', 'Si une plateforme n’a pas de catalogue dans votre pays, l’extension utilise', 'Wenn eine Plattform in deinem Land keinen Katalog hat, nutzt das Add-on', 'Se una piattaforma non ha un catalogo nel tuo paese, l’add-on usa'],
  ['para que la fila no quede vacía.', 'so the row is not left empty.', 'para que a linha não fique vazia.', 'pour éviter une ligne vide.', 'damit die Zeile nicht leer bleibt.', 'per evitare che la riga resti vuota.'],
  ['como respaldo', 'as a fallback', 'como alternativa', 'en secours', 'als Ersatz', 'come alternativa'],
  ['y luego', 'then', 'e depois', 'puis', 'danach', 'poi'],
  ['No conectado. Opcional: los torrents públicos seguirán funcionando.', 'Not connected. Optional: public torrents will continue to work.', 'Não conectado. Opcional: os torrents públicos continuarão funcionando.', 'Non connecté. Facultatif : les torrents publics continueront de fonctionner.', 'Nicht verbunden. Optional: Öffentliche Torrents funktionieren weiterhin.', 'Non connesso. Facoltativo: i torrent pubblici continueranno a funzionare.'],
  ['Ningún proveedor seleccionado: solo catálogos y fichas, sin streams.', 'No provider selected: catalogs and title pages only, no streams.', 'Nenhum provedor selecionado: apenas catálogos e fichas, sem streams.', 'Aucun fournisseur sélectionné : catalogues et fiches uniquement, sans streams.', 'Kein Anbieter ausgewählt: nur Kataloge und Titelseiten, keine Streams.', 'Nessun provider selezionato: solo cataloghi e schede, senza stream.'],
  ['Sin ningún proveedor marcado, el addon no devolverá streams: solo catálogos y fichas.', 'With no provider selected, the add-on returns catalogs and title pages only—no streams.', 'Sem nenhum provedor selecionado, o complemento mostra apenas catálogos e fichas, sem streams.', 'Sans fournisseur sélectionné, l’extension affiche uniquement les catalogues et les fiches, sans streams.', 'Ohne ausgewählten Anbieter zeigt das Add-on nur Kataloge und Titelseiten, keine Streams.', 'Senza provider selezionati, l’add-on mostra solo cataloghi e schede, senza stream.'],
  ['Reconectar', 'Reconnect', 'Reconectar', 'Reconnecter', 'Erneut verbinden', 'Ricollega'],
  ['Configuración debrid antigua detectada. Vuelve a conectar un proveedor para renovar la credencial de forma segura.', 'An old debrid setup was detected. Reconnect a provider to renew the credential securely.', 'Foi detectada uma configuração debrid antiga. Reconecte um provedor para renovar a credencial com segurança.', 'Ancienne configuration debrid détectée. Reconnectez un fournisseur pour renouveler l’identifiant en toute sécurité.', 'Alte Debrid-Konfiguration erkannt. Verbinde einen Anbieter erneut, um die Zugangsdaten sicher zu erneuern.', 'Rilevata una vecchia configurazione debrid. Ricollega un provider per rinnovare le credenziali in sicurezza.'],
  ['Conectado a Real-Debrid mediante OAuth. Solo se muestran torrents completados de tu biblioteca personal; no se consulta la caché global ni se añaden torrents.', 'Connected to Real-Debrid via OAuth. Only completed torrents in your personal library are shown; the global cache is not queried and no torrents are added.', 'Conectado ao Real-Debrid via OAuth. Apenas torrents concluídos da sua biblioteca pessoal são exibidos; o cache global não é consultado e nenhum torrent é adicionado.', 'Connecté à Real-Debrid via OAuth. Seuls les torrents terminés de votre bibliothèque personnelle sont affichés ; le cache global n’est pas consulté et aucun torrent n’est ajouté.', 'Mit Real-Debrid per OAuth verbunden. Angezeigt werden nur fertige Torrents aus deiner persönlichen Bibliothek; der globale Cache wird nicht abgefragt und es werden keine Torrents hinzugefügt.', 'Connesso a Real-Debrid tramite OAuth. Vengono mostrati solo i torrent completati della tua libreria personale; non si consulta la cache globale né si aggiungono torrent.'],
  ['Conectado a TorBox. Solo se añaden resultados tras un hit de caché y con add_only_if_cached=true; el elemento puede quedar en tu cuenta.', 'Connected to TorBox. Results are added only after a cache hit with add_only_if_cached=true; the item may remain in your account.', 'Conectado ao TorBox. Os resultados só são adicionados após um hit no cache com add_only_if_cached=true; o item pode permanecer na sua conta.', 'Connecté à TorBox. Les résultats ne sont ajoutés qu’après un succès du cache avec add_only_if_cached=true ; l’élément peut rester dans votre compte.', 'Mit TorBox verbunden. Ergebnisse werden nur nach Cache-Treffer mit add_only_if_cached=true hinzugefügt; das Element kann in deinem Konto verbleiben.', 'Connesso a TorBox. I risultati vengono aggiunti solo dopo un riscontro in cache con add_only_if_cached=true; l’elemento può restare nel tuo account.'],
  ['Conectado a Premiumize. La consulta de caché es best-effort; la generación del enlace directo puede consumir fair-use.', 'Connected to Premiumize. Cache checks are best-effort; generating a direct link may use fair-use.', 'Conectado ao Premiumize. A verificação do cache é best-effort; gerar um link direto pode consumir fair-use.', 'Connecté à Premiumize. La vérification du cache est indicative ; générer un lien direct peut consommer le fair-use.', 'Mit Premiumize verbunden. Die Cache-Prüfung ist unverbindlich; ein Direktlink kann Fair-Use verbrauchen.', 'Connesso a Premiumize. Il controllo della cache è best-effort; generare un link diretto può consumare fair-use.'],
  ['Conectado a EasyDebrid. Se genera un enlace solo después de confirmar el estado cacheado.', 'Connected to EasyDebrid. A link is generated only after confirming the item is cached.', 'Conectado ao EasyDebrid. Um link é gerado somente após confirmar o item no cache.', 'Connecté à EasyDebrid. Un lien est généré uniquement après confirmation de la présence en cache.', 'Mit EasyDebrid verbunden. Ein Link wird erst nach bestätigtem Cache-Status erstellt.', 'Connesso a EasyDebrid. Il link viene generato solo dopo aver confermato la presenza in cache.'],
  ['Se ocultan:', 'Hidden:', 'Ocultos:', 'Masqués :', 'Ausgeblendet:', 'Nascosti:'],
  ['No se oculta nada: verás todos los streams.', 'Nothing is hidden: you will see all streams.', 'Nada está oculto: você verá todos os streams.', 'Aucun élément masqué : tous les streams seront affichés.', 'Nichts ausgeblendet: Alle Streams werden angezeigt.', 'Non è nascosto nulla: vedrai tutti gli stream.'],
  ['Orden:', 'Sort:', 'Ordem:', 'Tri :', 'Sortierung:', 'Ordine:'],
  ['Tamaño máximo:', 'Maximum size:', 'Tamanho máximo:', 'Taille maximale :', 'Maximale Größe:', 'Dimensione massima:'],
  ['Has desmarcado todo en', 'You unchecked every option in', 'Você desmarcou todas as opções em', 'Vous avez tout décoché dans', 'Du hast alle Optionen deaktiviert unter', 'Hai deselezionato tutte le opzioni in'],
  ['y', 'and', 'e', 'et', 'und', 'e'],
  ['no quedará ningún stream que mostrar. Deja al menos una opción marcada.', 'no streams will remain. Keep at least one option selected.', 'nenhum stream restará. Mantenha pelo menos uma opção selecionada.', 'aucun stream ne restera. Gardez au moins une option cochée.', 'bleiben keine Streams übrig. Lass mindestens eine Option aktiviert.', 'non resterà alcuno stream. Lascia selezionata almeno un’opzione.'],
  ['Desconectar proveedor anterior', 'Disconnect previous provider', 'Desconectar provedor anterior', 'Déconnecter l’ancien fournisseur', 'Vorherigen Anbieter trennen', 'Disconnetti il provider precedente'],
  ['Opcional · sin conectar', 'Optional · not connected', 'Opcional · não conectado', 'Facultatif · non connecté', 'Optional · nicht verbunden', 'Opzionale · non connesso'],
  ['Todo visible', 'Everything visible', 'Tudo visível', 'Tout afficher', 'Alles sichtbar', 'Tutto visibile'],
  ['Recuperando…', 'Recovering…', 'Recuperando…', 'Récupération…', 'Wird wiederhergestellt…', 'Ripristino…'],
  ['Cargando…', 'Loading…', 'Carregando…', 'Chargement…', 'Wird geladen…', 'Caricamento…'],

  // Dynamic status messages on /configure.
  ['No se pudo conectar', 'Could not connect to', 'Não foi possível conectar', 'Connexion impossible à', 'Verbindung fehlgeschlagen zu', 'Impossibile collegarsi a'],
  ['No se pudo desconectar.', 'Could not disconnect.', 'Não foi possível desconectar.', 'Déconnexion impossible.', 'Trennen fehlgeschlagen.', 'Impossibile disconnettere.'],
  ['Espera un minuto antes de volver a conectar.', 'Wait a minute before reconnecting.', 'Aguarde um minuto antes de tentar conectar novamente.', 'Attendez une minute avant de vous reconnecter.', 'Warte eine Minute, bevor du dich erneut verbindest.', 'Attendi un minuto prima di riconnetterti.'],
  ['Real-Debrid debe conectarse mediante OAuth; no pegues tu token API privado.', 'Real-Debrid must be connected via OAuth; do not paste your private API token.', 'O Real-Debrid deve ser conectado via OAuth; não cole seu token de API privado.', 'Real-Debrid doit être connecté via OAuth ; ne collez pas votre jeton API privé.', 'Real-Debrid muss per OAuth verbunden werden; füge deinen privaten API-Token nicht ein.', 'Real-Debrid deve essere collegato tramite OAuth; non incollare il tuo token API privato.'],
  ['Selecciona un proveedor y pega una clave API válida.', 'Select a provider and paste a valid API key.', 'Selecione um provedor e cole uma chave de API válida.', 'Sélectionnez un fournisseur et collez une clé API valide.', 'Wähle einen Anbieter und füge einen gültigen API-Schlüssel ein.', 'Seleziona un provider e incolla una chiave API valida.'],
  ['El servidor debe configurar almacenamiento privado y DEBRID_ENCRYPTION_KEY.', 'The server must configure private storage and DEBRID_ENCRYPTION_KEY.', 'O servidor precisa configurar o armazenamento privado e DEBRID_ENCRYPTION_KEY.', 'Le serveur doit configurer le stockage privé et DEBRID_ENCRYPTION_KEY.', 'Der Server muss den privaten Speicher und DEBRID_ENCRYPTION_KEY konfigurieren.', 'Il server deve configurare l’archiviazione privata e DEBRID_ENCRYPTION_KEY.'],
  ['El proveedor rechazó la clave API. Compruébala en tu cuenta.', 'The provider rejected the API key. Check it in your account.', 'O provedor rejeitou a chave de API. Confira-a na sua conta.', 'Le fournisseur a refusé la clé API. Vérifiez-la dans votre compte.', 'Der Anbieter hat den API-Schlüssel abgelehnt. Prüfe ihn in deinem Konto.', 'Il provider ha rifiutato la chiave API. Verificala nel tuo account.'],
  ['Pega primero la clave API de', 'Paste the API key for', 'Cole primeiro a chave API de', 'Collez d’abord la clé API de', 'Füge zuerst den API-Schlüssel für', 'Incolla prima la chiave API di'],
  ['Validando la clave API de', 'Validating the API key for', 'Validando a chave API de', 'Vérification de la clé API de', 'API-Schlüssel wird geprüft für', 'Verifica della chiave API di'],
  ['Abriendo la autorización oficial de Real-Debrid…', 'Opening official Real-Debrid authorization…', 'Abrindo a autorização oficial do Real-Debrid…', 'Ouverture de l’autorisation officielle Real-Debrid…', 'Offizielle Real-Debrid-Autorisierung wird geöffnet…', 'Apertura dell’autorizzazione ufficiale Real-Debrid…'],
  ['Desconectando…', 'Disconnecting…', 'Desconectando…', 'Déconnexion…', 'Verbindung wird getrennt…', 'Disconnessione…'],
  ['Real-Debrid quedó conectado mediante OAuth. La integración solo usará los torrents descargados de tu biblioteca personal.', 'Real-Debrid is connected via OAuth. The integration will only use downloaded torrents from your personal library.', 'O Real-Debrid foi conectado via OAuth. A integração usará apenas torrents baixados da sua biblioteca pessoal.', 'Real-Debrid est connecté via OAuth. L’intégration utilisera uniquement les torrents téléchargés de votre bibliothèque personnelle.', 'Real-Debrid ist per OAuth verbunden. Es werden nur heruntergeladene Torrents aus deiner persönlichen Bibliothek verwendet.', 'Real-Debrid è connesso tramite OAuth. L’integrazione userà solo torrent scaricati dalla tua libreria personale.'],
  ['Cancelaste la autorización de Real-Debrid.', 'You cancelled Real-Debrid authorization.', 'Você cancelou a autorização do Real-Debrid.', 'Vous avez annulé l’autorisation Real-Debrid.', 'Du hast die Real-Debrid-Autorisierung abgebrochen.', 'Hai annullato l’autorizzazione Real-Debrid.'],
  ['Este despliegue no ha configurado las credenciales OAuth de Real-Debrid.', 'This deployment has not configured Real-Debrid OAuth credentials.', 'Este ambiente não configurou as credenciais OAuth do Real-Debrid.', 'Ce déploiement n’a pas configuré les identifiants OAuth Real-Debrid.', 'Für diese Bereitstellung sind keine Real-Debrid-OAuth-Zugangsdaten eingerichtet.', 'Questo deployment non ha configurato le credenziali OAuth di Real-Debrid.'],
  ['Este despliegue no tiene almacenamiento de credenciales cifrado configurado.', 'This deployment has no encrypted credential storage configured.', 'Este ambiente não configurou o armazenamento criptografado de credenciais.', 'Ce déploiement n’a pas configuré le stockage chiffré des identifiants.', 'Für diese Bereitstellung ist kein verschlüsselter Zugangsdaten-Speicher eingerichtet.', 'Questo deployment non ha configurato l’archiviazione cifrata delle credenziali.'],
  ['No se pudo completar OAuth con Real-Debrid. Inténtalo de nuevo.', 'Real-Debrid OAuth could not be completed. Please try again.', 'Não foi possível concluir o OAuth do Real-Debrid. Tente novamente.', 'Impossible de terminer OAuth avec Real-Debrid. Réessayez.', 'Real-Debrid-OAuth konnte nicht abgeschlossen werden. Bitte versuche es erneut.', 'Impossibile completare OAuth con Real-Debrid. Riprova.'],
  ['Etiquetas de stream', 'Stream badges', 'Etiquetas de stream', 'Badges de stream', 'Stream-Badges', 'Badge degli stream'],
  ['Qué datos técnicos se escriben en cada stream (4K · DV · HEVC · Atmos · 7.1 · WEB-DL…). En Stremio se ven como texto; en Nuvio pueden dibujarse como insignias con imágenes.', 'Which technical facts are written into each stream (4K · DV · HEVC · Atmos · 7.1 · WEB-DL…). Stremio shows them as text; Nuvio can draw them as image badges.', 'Que dados técnicos são escritos em cada stream (4K · DV · HEVC · Atmos · 7.1 · WEB-DL…). No Stremio aparecem como texto; no Nuvio podem virar selos com imagens.', 'Quelles données techniques sont écrites dans chaque stream (4K · DV · HEVC · Atmos · 7.1 · WEB-DL…). Stremio les affiche en texte ; Nuvio peut les dessiner en badges image.', 'Welche technischen Angaben in jedem Stream stehen (4K · DV · HEVC · Atmos · 7.1 · WEB-DL…). Stremio zeigt sie als Text; Nuvio kann sie als Bild-Badges darstellen.', 'Quali dati tecnici vengono scritti in ogni stream (4K · DV · HEVC · Atmos · 7.1 · WEB-DL…). Su Stremio si leggono come testo; su Nuvio possono diventare badge con immagini.'],
  ['Todas', 'All', 'Todas', 'Toutes', 'Alle', 'Tutte'],
  ['Esenciales', 'Essentials', 'Essenciais', 'Essentielles', 'Essenzielle', 'Essenziali'],
  ['Estilo de la vista previa', 'Preview style', 'Estilo da pré-visualização', 'Style de l’aperçu', 'Stil der Vorschau', 'Stile dell’anteprima'],
  ['Así se verían las etiquetas del stream con cada estilo.', 'How stream badges would look in each style.', 'Como as etiquetas apareceriam em cada estilo.', 'À quoi ressembleraient les badges de stream avec chaque style.', 'So sähen die Stream-Badges in jedem Stil aus.', 'Come apparirebbero le badge degli stream con ogni stile.'],
  ['Vista previa', 'Preview', 'Pré-visualização', 'Aperçu', 'Vorschau', 'Anteprima'],
  ['En Stremio estas etiquetas se leen como texto. Las insignias con imágenes solo las dibuja Nuvio (Perfil → Layout → Streams → «Fusion badge URLs»), pegando el manifiesto de un pack como ', 'In Stremio these badges read as text. Image badges are drawn only by Nuvio (Profile → Layout → Streams → “Fusion badge URLs”), by pasting the manifest of a pack such as ', 'No Stremio estas etiquetas são lidas como texto. Os selos com imagens são desenhados apenas pelo Nuvio (Perfil → Layout → Streams → «Fusion badge URLs»), colando o manifesto de um pack como ', 'Dans Stremio, ces badges se lisent en texte. Les badges image ne sont dessinés que par Nuvio (Profil → Layout → Streams → « Fusion badge URLs »), en collant le manifeste d’un pack comme ', 'In Stremio werden diese Badges als Text gelesen. Bild-Badges zeichnet nur Nuvio (Profil → Layout → Streams → „Fusion badge URLs“), indem man das Manifest eines Packs wie ', 'Su Stremio queste badge si leggono come testo. Le badge con immagini sono disegnate solo da Nuvio (Profilo → Layout → Streams → «Fusion badge URLs»), incollando il manifest di un pack come '],
  ['3D y HFR', '3D & HFR', '3D e HFR', '3D et HFR', '3D & HFR', '3D e HFR'],
  ['Rango dinámico', 'Dynamic range', 'Faixa dinâmica', 'Plage dynamique', 'Dynamikumfang', 'Gamma dinamica'],
  ['Códec de vídeo', 'Video codec', 'Codec de vídeo', 'Codec vidéo', 'Video-Codec', 'Codec video'],
  ['Códec de audio', 'Audio codec', 'Codec de áudio', 'Codec audio', 'Audio-Codec', 'Codec audio'],
  ['Canales de audio', 'Audio channels', 'Canais de áudio', 'Canaux audio', 'Audiokanäle', 'Canali audio'],
  ['Fuente', 'Source', 'Fonte', 'Source', 'Quelle', 'Fonte'],
  ['Contenedor', 'Container', 'Contêiner', 'Conteneur', 'Container', 'Container'],
  ['Servicio', 'Service', 'Serviço', 'Service', 'Dienst', 'Servizio'],
  ['Audio y subtítulos', 'Audio & subtitles', 'Áudio e legendas', 'Audio et sous-titres', 'Audio & Untertitel', 'Audio e sottotitoli'],
  ['Ediciones', 'Editions', 'Edições', 'Éditions', 'Editionen', 'Edizioni'],
  ['8K, 4K, 1080p… del nombre del release', '8K, 4K, 1080p… from the release name', '8K, 4K, 1080p… do nome do release', '8K, 4K, 1080p… du nom du release', '8K, 4K, 1080p… aus dem Release-Namen', '8K, 4K, 1080p… dal nome della release'],
  ['SBS/OU y altas tasas de fotogramas', 'SBS/OU and high frame rates', 'SBS/OU e taxas altas de quadros', 'SBS/OU et fréquences d’images élevées', 'SBS/OU und hohe Bildraten', 'SBS/OU e frame rate elevati'],
  ['Dolby Vision, HDR10+, HLG, 10-bit', 'Dolby Vision, HDR10+, HLG, 10-bit', 'Dolby Vision, HDR10+, HLG, 10-bit', 'Dolby Vision, HDR10+, HLG, 10-bit', 'Dolby Vision, HDR10+, HLG, 10-bit', 'Dolby Vision, HDR10+, HLG, 10-bit'],
  ['HEVC, AV1, AVC, VP9…', 'HEVC, AV1, AVC, VP9…', 'HEVC, AV1, AVC, VP9…', 'HEVC, AV1, AVC, VP9…', 'HEVC, AV1, AVC, VP9…', 'HEVC, AV1, AVC, VP9…'],
  ['Atmos, TrueHD, DTS, DD+, FLAC…', 'Atmos, TrueHD, DTS, DD+, FLAC…', 'Atmos, TrueHD, DTS, DD+, FLAC…', 'Atmos, TrueHD, DTS, DD+, FLAC…', 'Atmos, TrueHD, DTS, DD+, FLAC…', 'Atmos, TrueHD, DTS, DD+, FLAC…'],
  ['7.1, 5.1, 2.0, mono', '7.1, 5.1, 2.0, mono', '7.1, 5.1, 2.0, mono', '7.1, 5.1, 2.0, mono', '7.1, 5.1, 2.0, Mono', '7.1, 5.1, 2.0, mono'],
  ['REMUX, BluRay, WEB-DL, HDTV, CAM…', 'REMUX, BluRay, WEB-DL, HDTV, CAM…', 'REMUX, BluRay, WEB-DL, HDTV, CAM…', 'REMUX, BluRay, WEB-DL, HDTV, CAM…', 'REMUX, BluRay, WEB-DL, HDTV, CAM…', 'REMUX, BluRay, WEB-DL, HDTV, CAM…'],
  ['MKV, MP4, AVI…', 'MKV, MP4, AVI…', 'MKV, MP4, AVI…', 'MKV, MP4, AVI…', 'MKV, MP4, AVI…', 'MKV, MP4, AVI…'],
  ['Netflix, Prime, Disney+… del nombre', 'Netflix, Prime, Disney+… from the name', 'Netflix, Prime, Disney+… do nome', 'Netflix, Prime, Disney+… du nom', 'Netflix, Prime, Disney+… aus dem Namen', 'Netflix, Prime, Disney+… dal nome'],
  ['Multi, dual, dub, subs, CC', 'Multi, dual, dub, subs, CC', 'Multi, dual, dub, subs, CC', 'Multi, dual, dub, subs, CC', 'Multi, dual, Dub, Subs, CC', 'Multi, dual, dub, subs, CC'],
  ['IMAX, Criterion, Director’s Cut…', 'IMAX, Criterion, Director’s Cut…', 'IMAX, Criterion, Director’s Cut…', 'IMAX, Criterion, Director’s Cut…', 'IMAX, Criterion, Director’s Cut…', 'IMAX, Criterion, Director’s Cut…'],
  ['ESP, LAT, ENG, JPN… del nombre', 'ESP, LAT, ENG, JPN… from the name', 'ESP, LAT, ENG, JPN… do nome', 'ESP, LAT, ENG, JPN… du nom', 'ESP, LAT, ENG, JPN… aus dem Namen', 'ESP, LAT, ENG, JPN… dal nome'],

  ['Elige tu servicio', 'Choose your service', 'Escolha o seu serviço', 'Choisissez votre service', 'Wähle deinen Dienst', 'Scegli il tuo servizio'],
  ['Clave API', 'API key', 'Chave de API', 'Clé API', 'API-Schlüssel', 'Chiave API'],
  ['Clave API del servicio', 'Service API key', 'Chave de API do serviço', 'Clé API du service', 'API-Schlüssel des Dienstes', 'Chiave API del servizio'],
  ['Mostrar', 'Show', 'Mostrar', 'Afficher', 'Anzeigen', 'Mostra'],
  ['Ocultar', 'Hide', 'Ocultar', 'Masquer', 'Ausblenden', 'Nascondi'],
  ['Muestra la clave mientras la revisas', 'Show the key while you check it', 'Mostra a chave enquanto você revisa', 'Affiche la clé pendant que vous la vérifiez', 'Zeigt den Schlüssel, während du ihn prüfst', 'Mostra la chiave mentre la controlli'],
  ['En TorBox la clave está en torbox.app › Ajustes › «API Key»; no es el token de sesión ni la contraseña.', 'Your TorBox key is on torbox.app › Settings › “API key”; it is not your session token or your password.', 'A chave do TorBox está em torbox.app › Configurações › “API key”; não é o token de sessão nem a senha.', 'La clé TorBox se trouve sur torbox.app › Paramètres › « Clé API » ; ce n’est ni le jeton de session ni le mot de passe.', 'Den TorBox-Schlüssel findest du unter torbox.app › Einstellungen › „API key“; das ist weder dein Session-Token noch dein Passwort.', 'La chiave TorBox è su torbox.app › Impostazioni › “API key”; non è il token di sessione né la password.'],
  ['En EasyDebrid la clave está en el panel de tu cuenta, apartado API.', 'Your EasyDebrid key is in your account panel, under API.', 'A chave do EasyDebrid está no painel da sua conta, na seção API.', 'La clé EasyDebrid se trouve dans le panneau de ton compte, rubrique API.', 'Den EasyDebrid-Schlüssel findest du im Konto-Panel unter API.', 'La chiave EasyDebrid è nel pannello del tuo account, nella sezione API.'],
  ['En Premiumize la clave está en premiumize.me › Mi cuenta › «API key»; el Customer ID no sirve.', 'Your Premiumize key is on premiumize.me › My account › “API key”; the Customer ID does not work.', 'A chave do Premiumize está em premiumize.me › Minha conta › “API key”; o Customer ID não serve.', 'La clé Premiumize se trouve sur premiumize.me › Mon compte › « Clé API » ; l’ID client ne fonctionne pas.', 'Den Premiumize-Schlüssel findest du unter premiumize.me › Mein Konto › „API key“; die Customer-ID funktioniert nicht.', 'La chiave Premiumize è su premiumize.me › Il mio account › “API key”; il Customer ID non va bene.'],
  ['Real-Debrid no pide ninguna clave: pulsa «Autorizar con Real-Debrid» y decide en su web qué permisos das.', 'Real-Debrid needs no key: press “Authorize with Real-Debrid” and choose the permissions on its site.', 'O Real-Debrid não pede chave: toque em “Autorizar com Real-Debrid” e escolha as permissões no site dele.', 'Real-Debrid ne demande aucune clé : clique sur « Autoriser avec Real-Debrid » et choisis les autorisations sur son site.', 'Real-Debrid braucht keinen Schlüssel: Tippe auf „Mit Real-Debrid autorisieren“ und wähle die Berechtigungen auf deren Website.', 'Real-Debrid non chiede alcuna chiave: premi «Autorizza con Real-Debrid» e scegli i permessi sul loro sito.'],
  ['Aún no has conectado ningún servicio. Es opcional: los torrents públicos seguirán funcionando.', 'No service connected yet. It is optional: public torrents will keep working.', 'Nenhum serviço conectado ainda. É opcional: os torrents públicos continuarão funcionando.', 'Aucun service n’est connecté. C’est facultatif : les torrents publics continueront de fonctionner.', 'Noch ist kein Dienst verbunden. Das ist optional: öffentliche Torrents funktionieren weiter.', 'Nessun servizio ancora collegato. È facoltativo: i torrent pubblici continueranno a funzionare.'],
  ['Comprobando la clave en el servicio…', 'Checking the key with the service…', 'Verificando a chave no serviço…', 'Vérification de la clé auprès du service…', 'Der Schlüssel wird beim Dienst geprüft…', 'Verifica della chiave presso il servizio…'],
  ['Conectado a TorBox. Solo se añaden resultados con un hit de su caché y sin sembrar (seed=3); el elemento puede quedar en tu cuenta.', 'Connected to TorBox. Only cache hits are added, without seeding (seed=3); the item may stay in your account.', 'Conectado ao TorBox. Só itens já na cache são adicionados, sem semear (seed=3); o item pode ficar na sua conta.', 'Connecté à TorBox. Seuls les résultats déjà en cache sont ajoutés, sans seeding (seed=3) ; l’élément peut rester dans ton compte.', 'Mit TorBox verbunden. Es werden nur Cache-Treffer und ohne zu seeden hinzugefügt (seed=3); der Eintrag bleibt ggf. in deinem Konto.', 'Connesso a TorBox. Vengono aggiunti solo risultati già in cache, senza seedare (seed=3); l’elemento può restare nel tuo account.'],
  ['Conectado a EasyDebrid. El enlace se genera solo después de confirmar que el archivo está en caché.', 'Connected to EasyDebrid. The link is generated only after confirming the file is cached.', 'Conectado ao EasyDebrid. O link é gerado só depois de confirmar que o arquivo está na cache.', 'Connecté à EasyDebrid. Le lien n’est généré qu’après confirmation de la mise en cache du fichier.', 'Mit EasyDebrid verbunden. Der Link wird erst erzeugt, nachdem die Datei im Cache bestätigt ist.', 'Connesso a EasyDebrid. Il link viene generato solo dopo aver confermato che il file è in cache.'],
  ['Conectado a Premiumize. La comprobación de caché es best-effort y crear el enlace directo puede consumir fair-use.', 'Connected to Premiumize. The cache check is best-effort and creating the direct link may use fair-use.', 'Conectado ao Premiumize. A checagem de cache é aproximada e criar o link direto pode consumir fair-use.', 'Connecté à Premiumize. La vérification du cache est au mieux et créer le lien direct peut consommer du fair-use.', 'Mit Premiumize verbunden. Der Cache-Check ist best effort und das Erzeugen des Direktlinks kann Fair-Use verbrauchen.', 'Connesso a Premiumize. Il controllo della cache è best-effort e creare il link diretto può consumare fair-use.'],
  ['Conectado a Real-Debrid con OAuth. Se usan solo torrents ya descargados en tu biblioteca personal; no se consulta la caché global.', 'Connected to Real-Debrid via OAuth. Only torrents already downloaded in your personal library are used; the global cache is not queried.', 'Conectado ao Real-Debrid via OAuth. Só torrents já baixados na sua biblioteca pessoal são usados; a cache global não é consultada.', 'Connecté à Real-Debrid via OAuth. Seuls les torrents déjà téléchargés dans ta bibliothèque personnelle sont utilisés ; le cache global n’est pas consulté.', 'Mit Real-Debrid über OAuth verbunden. Genutzt werden nur bereits heruntergeladene Torrents deiner persönlichen Bibliothek; der globale Cache wird nicht abgefragt.', 'Connesso a Real-Debrid via OAuth. Vengono usati solo torrent già scaricati nella tua libreria personale; la cache globale non viene consultata.'],
  ['La clave es válida, pero la cuenta no muestra una suscripción activa: el servicio puede no devolver enlaces directos.', 'The key is valid, but the account shows no active subscription: the service may return no direct links.', 'A chave é válida, mas a conta não mostra assinatura ativa: o serviço pode não devolver links diretos.', 'La clé est valide, mais le compte n’indique pas d’abonnement actif : le service peut ne pas renvoyer de liens directs.', 'Der Schlüssel ist gültig, aber das Konto zeigt kein aktives Abo: der Dienst liefert eventuell keine Direktlinks.', 'La chiave è valida, ma l’account non mostra un abbonamento attivo: il servizio potrebbe non restituire link diretti.'],
  ['Esta conexión debrid es de una versión anterior del addon. Vuelve a conectar el servicio para renovar la credencial de forma segura.', 'This debrid connection is from an older version of the add-on. Connect the service again to renew the credential safely.', 'Esta conexão debrid é de uma versão anterior do addon. Conecte o serviço de novo para renovar a credencial com segurança.', 'Cette connexion debrid vient d’une version antérieure de l’addon. Reconnecte le service pour renouveler l’identifiant en toute sécurité.', 'Diese Debrid-Verbindung stammt aus einer älteren Version des Add-ons. Verbinde den Dienst erneut, um die Zugangsdaten sicher zu erneuern.', 'Questa connessione debrid viene da una versione precedente dell’addon. Ricollega il servizio per rinnovare in sicurezza la credenziale.'],
  ['Pega primero la clave API del servicio.', 'Paste the service API key first.', 'Cole primeiro a chave de API do serviço.', 'Colle d’abord la clé API du service.', 'Füge zuerst den API-Schlüssel des Dienstes ein.', 'Incolla prima la chiave API del servizio.'],
  ['El servicio no reconoció esa clave. Cópiala entera desde su página de API, sin espacios y sin el prefijo «Bearer» (no es tu contraseña ni el correo).', 'The service did not recognise that key. Copy it in full from its API page, without spaces and without the “Bearer” prefix (it is not your password or your email).', 'O serviço não reconheceu essa chave. Copie-a inteira da página de API, sem espaços e sem o prefixo “Bearer” (não é sua senha nem seu e-mail).', 'Le service n’a pas reconnu cette clé. Copie-la en entier depuis sa page API, sans espaces ni préfixe « Bearer » (ce n’est ni ton mot de passe ni ton e-mail).', 'Der Dienst hat diesen Schlüssel nicht erkannt. Kopiere ihn vollständig von seiner API-Seite, ohne Leerzeichen und ohne „Bearer“-Präfix (das ist weder dein Passwort noch deine E-Mail-Adresse).', 'Il servizio non ha riconosciuto quella chiave. Copiala per intero dalla pagina API, senza spazi e senza il prefisso “Bearer” (non è la tua password né la tua email).'],
  ['La forma de la clave no es válida: le sobran o faltan caracteres, o has pegado otra cosa. Vuelve a copiarla entera, sin comillas ni saltos de línea.', 'The key format is not valid: too many or too few characters, or you pasted something else. Copy it again in full, without quotes or line breaks.', 'O formato da chave não é válido: faltam ou sobram caracteres, ou você colou outra coisa. Copie-a de novo inteira, sem aspas nem quebras de linha.', 'Le format de la clé n’est pas valide : caractères en trop ou en moins, ou tu as collé autre chose. Recopie-la en entier, sans guillemets ni sauts de ligne.', 'Das Schlüsselformat ist ungültig: zu viele oder zu wenige Zeichen, oder du hast etwas anderes eingefügt. Kopiere ihn erneut vollständig, ohne Anführungszeichen oder Umbrüche.', 'Il formato della chiave non è valido: caratteri in più o in meno, oppure hai incollato altro. Ricopiala per intero, senza virgolette o a capo.'],
  ['El servicio no respondió, así que no se pudo comprobar la clave. No se ha guardado nada: los torrents públicos siguen funcionando y puedes reintentar en un minuto.', 'The service did not respond, so the key could not be checked. Nothing was saved: public torrents keep working and you can retry in a minute.', 'O serviço não respondeu, então a chave não pôde ser verificada. Nada foi salvo: os torrents públicos continuam funcionando e você pode tentar de novo em um minuto.', 'Le service n’a pas répondu, la clé n’a donc pas pu être vérifiée. Rien n’a été enregistré : les torrents publics fonctionnent toujours et tu peux réessayer dans une minute.', 'Der Dienst hat nicht geantwortet, der Schlüssel konnte nicht geprüft werden. Es wurde nichts gespeichert: öffentliche Torrents laufen weiter, in einer Minute kannst du es erneut versuchen.', 'Il servizio non ha risposto, quindi non è stato possibile verificare la chiave. Non è stato salvato nulla: i torrent pubblici funzionano ancora e puoi riprovare tra un minuto.'],
  ['Has hecho demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.', 'Too many attempts in a row. Wait a minute and try again.', 'Você fez tentativas demais em sequência. Espere um minuto e tente de novo.', 'Trop de tentatives d’affilée. Attends une minute et réessaie.', 'Zu viele Versuche hintereinander. Warte eine Minute und versuche es erneut.', 'Hai fatto troppi tentativi di fila. Attendi un minuto e riprova.'],
  ['Este servidor no puede guardar credenciales: falta la clave DEBRID_ENCRYPTION_KEY o el almacenamiento debrid (KV o Cache API).', 'This server cannot store credentials: DEBRID_ENCRYPTION_KEY or the debrid storage (KV or Cache API) is missing.', 'Este servidor não pode guardar credenciais: falta a chave DEBRID_ENCRYPTION_KEY ou o armazenamento debrid (KV ou Cache API).', 'Ce serveur ne peut pas enregistrer d’identifiants : la clé DEBRID_ENCRYPTION_KEY ou le stockage debrid (KV ou Cache API) manque.', 'Dieser Server kann keine Zugangsdaten speichern: DEBRID_ENCRYPTION_KEY oder der Debrid-Speicher (KV oder Cache API) fehlt.', 'Questo server non può salvare le credenziali: manca la chiave DEBRID_ENCRYPTION_KEY o l’archivio debrid (KV o Cache API).'],
  ['No se pudo hablar con este servidor. Revisa tu conexión: la clave no se ha guardado.', 'This server could not be reached. Check your connection: the key was not saved.', 'Não foi possível falar com este servidor. Verifique sua conexão: a chave não foi salva.', 'Impossible de joindre ce serveur. Vérifie ta connexion : la clé n’a pas été enregistrée.', 'Dieser Server war nicht erreichbar. Prüfe deine Verbindung: der Schlüssel wurde nicht gespeichert.', 'Non è stato possibile contattare questo server. Controlla la tua connessione: la chiave non è stata salvata.'],
  ['No se pudo desconectar. Inténtalo de nuevo.', 'Could not disconnect. Try again.', 'Não foi possível desconectar. Tente de novo.', 'Impossible de déconnecter. Réessaie.', 'Verbindungstrennung fehlgeschlagen. Versuche es erneut.', 'Impossibile disconnettere. Riprova.'],
  ['La clave se valida y se guarda cifrada en el servidor: no viaja al navegador ni al manifest, que solo lleva un identificador opaco. No compartas tu URL personal.', 'The key is validated and stored encrypted on the server: it never reaches your browser or the manifest, which carries only an opaque id. Do not share your personal URL.', 'A chave é validada e guardada cifrada no servidor: não vai para o navegador nem para o manifest, que carrega apenas um identificador opaco. Não compartilhe sua URL pessoal.', 'La clé est validée et chiffrée sur le serveur : elle ne va ni au navigateur ni au manifest, qui ne contient qu’un identifiant opaque. Ne partage pas ton URL personnelle.', 'Der Schlüssel wird auf dem Server geprüft und verschlüsselt gespeichert: er gelangt weder in den Browser noch ins Manifest, das nur eine undurchsichtige ID enthält. Teile deine persönliche URL nicht.', 'La chiave viene validata e conservata cifrata sul server: non arriva al browser né al manifest, che contiene solo un identificatore opaco. Non condividere la tua URL personale.'],
  ['En Stremio estas etiquetas se leen como texto. Las insignias con imágenes solo las dibuja Nuvio, en Perfil → Layout → Streams → «Fusion badge URLs», y ahí se pega el manifiesto de un pack de etiquetas.',
   'In Stremio these labels are read as text. Image badges are only drawn by Nuvio, under Profile → Layout → Streams → “Fusion badge URLs”, where you paste the manifest of a badge pack.',
   'No Stremio esses rótulos são lidos como texto. Insígnias com imagens só o Nuvio desenha, em Perfil → Layout → Streams → “Fusion badge URLs”, e é ali que se cola o manifest de um pacote de insígnias.',
   'Dans Stremio ces étiquettes sont lues comme du texte. Les badges en images ne sont dessinés que par Nuvio, dans Profil → Layout → Streams → « Fusion badge URLs », où l’on colle le manifest d’un pack de badges.',
   'In Stremio werden diese Labels als Text gelesen. Bild-Abzeichen zeichnet nur Nuvio unter Profil → Layout → Streams → „Fusion badge URLs“; dort fügst du das Manifest eines Badge-Packs ein.',
   'In Stremio queste etichette sono lette come testo. I badge con immagini li disegna solo Nuvio, in Profilo → Layout → Streams → «Fusion badge URLs», dove incolla il manifest di un pacchetto di badge.'],
  ['Real-Debrid quedó conectado mediante OAuth. Solo se usarán torrents ya descargados en tu biblioteca personal.', 'Real-Debrid is now connected via OAuth. Only torrents already downloaded in your personal library will be used.', 'O Real-Debrid ficou conectado via OAuth. Só serão usados torrents já baixados na sua biblioteca pessoal.', 'Real-Debrid est connecté via OAuth. Seuls les torrents déjà téléchargés dans ta bibliothèque personnelle seront utilisés.', 'Real-Debrid ist über OAuth verbunden. Es werden nur bereits heruntergeladene Torrents deiner persönlichen Bibliothek genutzt.', 'Real-Debrid è connesso tramite OAuth. Verranno usati solo torrent già scaricati nella tua libreria personale.'],
  ['Cancelaste la autorización de Real-Debrid: no se guardó ninguna credencial.', 'You cancelled the Real-Debrid authorization: no credential was saved.', 'Você cancelou a autorização do Real-Debrid: nenhuma credencial foi salva.', 'Tu as annulé l’autorisation Real-Debrid : aucune identifiant n’a été enregistré.', 'Du hast die Real-Debrid-Autorisierung abgebrochen: es wurde nichts gespeichert.', 'Hai annullato l’autorizzazione di Real-Debrid: non è stata salvata alcuna credenziale.'],
  ['Este despliegue no tiene configuradas las credenciales OAuth de Real-Debrid (client ID, secret y URI de retorno).', 'This deployment has no Real-Debrid OAuth credentials configured (client id, secret and redirect URI).', 'Esta implantação não tem as credenciais OAuth do Real-Debrid configuradas (client ID, secret e URI de retorno).', 'Ce déploiement n’a pas de credentials OAuth Real-Debrid configurés (client id, secret et URI de redirection).', 'Für diesen Deployment sind keine Real-Debrid-OAuth-Zugangsdaten konfiguriert (Client-ID, Secret und Redirect-URI).', 'Questa distribuzione non ha le credenziali OAuth di Real-Debrid configurate (client id, secret e URI di rimando).'],
  ['No se pudo completar la autorización con Real-Debrid. Vuelve a intentarlo; si se repite, avisa en el canal de soporte.', 'Real-Debrid authorization could not be completed. Try again; if it keeps happening, let us know in the support channel.', 'Não foi possível concluir a autorização com o Real-Debrid. Tente de novo; se se repetir, avise no canal de suporte.', 'Impossible de terminer l’autorisation avec Real-Debrid. Réessaie ; si cela se reproduit, préviens dans le canal d’assistance.', 'Die Autorisierung mit Real-Debrid konnte nicht abgeschlossen werden. Versuche es erneut; wenn es wieder passiert, sag im Support-Kanal Bescheid.', 'Impossibile completare l’autorizzazione con Real-Debrid. Riprova; se si ripete, avvisa nel canale di supporto.'],
  ['Guía rápida de configuración', 'Quick setup guide', 'Guia rápida de configuração', 'Guide de configuration rapide', 'Schnelle Einrichtungsanleitung', 'Guida rapida alla configurazione'],
  ['Resolución, rango dinámico, fuente e idioma', 'Resolution, dynamic range, source and language', 'Resolução, faixa dinâmica, fonte e idioma', 'Résolution, plage dynamique, source et langue', 'Auflösung, Dynamikumfang, Quelle und Sprache', 'Risoluzione, gamma dinamica, fonte e lingua'],
  ['Solo original: «Dublado» o «Dual» en el nombre', 'Original only: “Dubbed” or “Dual” in the name', 'Só original: “Dublado” ou “Dual” no nome', 'Version originale uniquement : « Dubbed » ou « Dual » dans le nom', 'Nur Original: „Dublado“ oder „Dual“ im Namen', 'Solo originale: «Dubbed» o «Dual» nel nome'],
  ['Torrentio ES/Latino busca en MejorTorrent, Wolfmax4K y Cinecalidad; Índice BR aporta lanzamientos en portugués de Brasil. Knaben, Torlock y The RarBg son fuentes generales; Nyaa se usa para anime y producciones asiáticas, YTS para películas y EZTV para series. Torrentio usa una instancia pública de terceros y puedes desactivarlo si prefieres no depender de ella.', 'Torrentio ES/Latino searches MejorTorrent, Wolfmax4K and Cinecalidad; Índice BR adds Brazilian Portuguese releases. Knaben, Torlock and The RarBg are general sources; Nyaa covers anime and Asian releases, YTS movies and EZTV series. Torrentio uses a third-party public instance, which you can turn off if you would rather not depend on it.', 'O Torrentio ES/Latino busca no MejorTorrent, Wolfmax4K e Cinecalidad; o Índice BR traz lançamentos em português do Brasil. Knaben, Torlock e The RarBg são fontes gerais; Nyaa cobre anime e produções asiáticas, YTS para filmes e EZTV para séries. O Torrentio usa uma instância pública de terceiros e você pode desativá-lo se preferir não depender dela.', 'Torrentio ES/Latino cherche sur MejorTorrent, Wolfmax4K et Cinecalidad ; Índice BR ajoute les sorties en portugais du Brésil. Knaben, Torlock et The RarBg sont des sources générales ; Nyaa couvre l’anime et les productions asiatiques, YTS les films et EZTV les séries. Torrentio utilise une instance publique tierce, que tu peux désactiver si tu ne veux pas en dépendre.', 'Torrentio ES/Latino durchsucht MejorTorrent, Wolfmax4K und Cinecalidad; Índice BR bringt brasilianische PT-Releases. Knaben, Torlock und The RarBg sind allgemeine Quellen; Nyaa für Anime und asiatische Produktionen, YTS für Filme, EZTV für Serien. Torrentio nutzt eine öffentliche Dritt-Instanz, die du ausschalten kannst, wenn du davon unabhängig sein willst.', 'Torrentio ES/Latino cerca su MejorTorrent, Wolfmax4K e Cinecalidad; Índice BR aggiunge le uscite in portoghese brasiliano. Knaben, Torlock e The RarBg sono fonti generali; Nyaa copre anime e produzioni asiatiche, YTS i film e EZTV le serie. Torrentio usa un’istanza pubblica di terze parti, che puoi disattivare se preferisci non dipenderne.'],
  ['Se consultan en paralelo y se quitan los duplicados. Torrentio ES/Latino amplía el castellano y el doblaje latino; Índice BR aporta portugués de Brasil. También hay fuentes especializadas para anime, películas y series.', 'They are queried in parallel and duplicates are removed. Torrentio ES/Latino adds Spanish and Latin American dubs; Índice BR adds Brazilian Portuguese. There are also sources specialized in anime, movies and series.', 'Eles são consultados em paralelo e os duplicados são removidos. O Torrentio ES/Latino amplia o espanhol e a dublagem latina; o Índice BR traz português do Brasil. Também há fontes especializadas em anime, filmes e séries.', 'Ils sont interrogés en parallèle et les doublons sont retirés. Torrentio ES/Latino élargit l’espagnol et le doublage latino ; Índice BR apporte le portugais du Brésil. Il y a aussi des sources spécialisées pour l’anime, les films et les séries.', 'Sie werden parallel abgefragt und Duplikate entfernt. Torrentio ES/Latino erweitert Spanisch und lateinamerikanische Synchronfassungen; Índice BR bringt brasilianisches Portugiesisch. Es gibt auch Quellen für Anime, Filme und Serien.', 'Vengono consultati in parallelo e i duplicati vengono rimossi. Torrentio ES/Latino amplifica lo spagnolo e il doppiaggio latino; Índice BR aggiunge il portoghese brasiliano. Ci sono anche fonti specializzate in anime, film e serie.'],
];

const TRANSLATIONS = Object.fromEntries(LANGUAGES.map((language, index) => {
  const column = language === 'es' ? 0 : index;
  return [language, Object.fromEntries(PHRASES.map((row) => [row[0], row[column]]))];
}));

const DICTIONARY_JSON = JSON.stringify({
  languages: LANGUAGE_OPTIONS,
  translations: TRANSLATIONS,
  regions: REGION_OPTIONS.map(({ code, label }) => [code, label]),
  catalogLanguageCount: CATALOG_LANG_OPTIONS.length,
}).replace(/</g, '\\u003c');

const WEB_I18N_SCRIPT = `
(function () {
  'use strict';
  var DATA = ${DICTIONARY_JSON};
  var LANGS = ${JSON.stringify(LANGUAGES)};
  var STORE_KEY = ${JSON.stringify(WEB_LANGUAGE_STORAGE_KEY)};
  var root = document.documentElement;
  var sourceKeys = new Map();
  var originalText = new WeakMap();
  var originalAttributes = new WeakMap();
  var reverse = {};
  LANGS.forEach(function (lang) {
    reverse[lang] = new Map();
    var dictionary = DATA.translations[lang] || {};
    Object.keys(dictionary).forEach(function (source) {
      var normalizedSource = normalize(source);
      if (!sourceKeys.has(normalizedSource)) sourceKeys.set(normalizedSource, source);
      var target = normalize(dictionary[source]);
      if (!reverse[lang].has(target)) reverse[lang].set(target, source);
    });
  });

  function normalize(value) {
    return String(value == null ? '' : value).replace(/\\s+/g, ' ').trim();
  }
  function languageFrom(value) {
    var base = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
    return LANGS.indexOf(base) !== -1 ? base : '';
  }
  function browserLanguage() {
    var preferences = Array.isArray(navigator.languages) ? navigator.languages : [];
    if (navigator.language) preferences = preferences.concat([navigator.language]);
    for (var i = 0; i < preferences.length; i += 1) {
      var match = languageFrom(preferences[i]);
      if (match) return match;
    }
    return 'es';
  }
  function savedLanguage() {
    try {
      var saved = localStorage.getItem(STORE_KEY);
      return saved && LANGS.indexOf(saved) !== -1 ? saved : '';
    } catch (_) { return ''; }
  }
  var override = savedLanguage();
  var currentLanguage = override || browserLanguage();
  root.lang = currentLanguage;
  if (currentLanguage !== 'es') root.setAttribute('data-i18n-pending', '');

  function sourceFor(text, fromLanguage) {
    var value = normalize(text);
    if (sourceKeys.has(value)) return sourceKeys.get(value);
    return reverse[fromLanguage] && reverse[fromLanguage].get(value) || '';
  }
  function regionLabel(code, language) {
    try {
      return new Intl.DisplayNames([language], { type: 'region' }).of(code) || code;
    } catch (_) { return code; }
  }
  function languageLabel(code, language) {
    try {
      return new Intl.DisplayNames([language], { type: 'language' }).of(code) || code;
    } catch (_) { return code; }
  }
  function regionCodeFromName(name) {
    var wanted = normalize(name).toLocaleLowerCase('es');
    var hit = (DATA.regions || []).find(function (item) {
      return normalize(item[1]).toLocaleLowerCase('es') === wanted;
    });
    return hit ? hit[0] : '';
  }
  function phrase(source, language) {
    var key = sourceKeys.get(normalize(source)) || source;
    return DATA.translations[language][key] || source;
  }
  function translateDynamic(value, fromLanguage, toLanguage) {
    var text = normalize(value);
    var source = sourceFor(text, fromLanguage);
    if (source) return DATA.translations[toLanguage][source] || source;

    var match = text.match(/^(\\d+)\\s+(catálogos|plataformas|estudios|idiomas|regiones|filtros|filtros de streams|proveedores de streams)$/i);
    if (match) {
      var unitSource = match[2].toLowerCase();
      var unitKey = sourceFor(unitSource, fromLanguage) || unitSource;
      return match[1] + ' ' + (DATA.translations[toLanguage][unitKey] || unitKey);
    }
    match = text.match(/^(\\d+)\\s+plataformas y (\\d+)\\s+estudios$/i);
    if (match) {
      var conjunction = { es: 'y', en: 'and', pt: 'e', fr: 'et', de: 'und', it: 'e' }[toLanguage];
      return match[1] + ' ' + DATA.translations[toLanguage]['plataformas'] + ' ' + conjunction + ' '
        + match[2] + ' ' + DATA.translations[toLanguage]['estudios'];
    }
    match = text.match(/^(\\d+)\\s+de\\s+(\\d+)$/i);
    if (match) {
      var of = { es: 'de', en: 'of', pt: 'de', fr: 'sur', de: 'von', it: 'di' }[toLanguage];
      return match[1] + ' ' + of + ' ' + match[2];
    }
    match = text.match(/^(\\d+)\\s+ocultos?$/i);
    if (match) {
      var hiddenUnit = Number(match[1]) === 1 ? 'oculto' : 'ocultos';
      return match[1] + ' ' + phrase(hiddenUnit, toLanguage);
    }
    match = text.match(/^máx\\. (\\d+) GB$/i);
    if (match) {
      var maxLabel = { es: 'máx.', en: 'max.', pt: 'máx.', fr: 'max.', de: 'max.', it: 'max.' }[toLanguage];
      return maxLabel + ' ' + match[1] + ' GB';
    }
    match = text.match(/^(película|serie)( · .*)?$/i);
    if (match) {
      var mediaSource = match[1].toLowerCase() === 'película' ? 'Película' : 'Serie';
      return (DATA.translations[toLanguage][mediaSource] || mediaSource) + (match[2] || '');
    }
    match = text.match(/^(más seeders|mejor calidad|menor tamaño)\\.$/i);
    if (match) {
      var sortKey = match[1][0].toUpperCase() + match[1].slice(1);
      return (DATA.translations[toLanguage][sortKey] || sortKey) + '.';
    }
    match = text.match(/^(los que mejor cargan primero|de 4k a sd; cam y screeners al final|los más ligeros primero)\\.$/i);
    if (match) return phrase(match[1][0].toUpperCase() + match[1].slice(1), toLanguage) + '.';
    match = text.match(/^no se pudo validar (torbox|easydebrid|premiumize)\. inténtalo más tarde\.$/i);
    if (match) {
      var providerLabels = { torbox: 'TorBox', easydebrid: 'EasyDebrid', premiumize: 'Premiumize' };
      var providerLabel = providerLabels[match[1].toLowerCase()] || match[1];
      var providerErrors = {
        es: 'No se pudo validar ' + providerLabel + '. Inténtalo más tarde.',
        en: 'Could not validate ' + providerLabel + '. Try again later.',
        pt: 'Não foi possível validar o ' + providerLabel + '. Tente novamente mais tarde.',
        fr: 'Impossible de valider ' + providerLabel + '. Réessayez plus tard.',
        de: 'Der Anbieter ' + providerLabel + ' konnte nicht validiert werden. Bitte versuche es später erneut.',
        it: 'Impossibile convalidare ' + providerLabel + '. Riprova più tardi.',
      };
      return providerErrors[toLanguage];
    }
    match = text.match(/^(validar y conectar|desconectar|no se pudo conectar|pega primero la clave api de|validando la clave api de) (.+)$/i);
    if (match) {
      var prefixKeys = {
        'validar y conectar': 'Validar y conectar',
        'desconectar': 'Desconectar',
        'no se pudo conectar': 'No se pudo conectar',
        'pega primero la clave api de': 'Pega primero la clave API de',
        'validando la clave api de': 'Validando la clave API de',
      };
      var prefix = DATA.translations[toLanguage][prefixKeys[match[1].toLowerCase()]];
      if (prefix) return prefix + ' ' + match[2];
    }
    match = text.match(/^(\\d+)\\s+catálogos para Stremio: (.+)$/i);
    if (match) {
      var seo = {
        es: 'catálogos para Stremio: tendencias, estrenos, top valoradas, por plataforma (Netflix, Disney+, Max, Hulu, AMC+…) y por estudio (Marvel, Pixar, Ghibli…). Streams con filtros (oculta CAM, 3D, 4K…), {{languages}} idiomas y {{regions}} regiones. Gratis y sin cuenta.',
        en: 'Stremio catalogs: trending, new releases, top rated, by platform (Netflix, Disney+, Max, Hulu, AMC+…) and studio (Marvel, Pixar, Ghibli…). Filter streams (hide CAM, 3D, 4K…), {{languages}} languages and {{regions}} regions. Free, no account required.',
        pt: 'catálogos para Stremio: em alta, lançamentos, mais bem avaliados, por plataforma (Netflix, Disney+, Max, Hulu, AMC+…) e estúdio (Marvel, Pixar, Ghibli…). Filtre streams (oculte CAM, 3D, 4K…), {{languages}} idiomas e {{regions}} regiões. Grátis e sem conta.',
        fr: 'catalogues Stremio : tendances, nouveautés, mieux notés, par plateforme (Netflix, Disney+, Max, Hulu, AMC+…) et studio (Marvel, Pixar, Ghibli…). Filtrez les streams (masquez CAM, 3D, 4K…), {{languages}} langues et {{regions}} régions. Gratuit, sans compte.',
        de: 'Stremio-Kataloge: Trends, Neuerscheinungen, Top-Bewertungen, nach Plattform (Netflix, Disney+, Max, Hulu, AMC+…) und Studio (Marvel, Pixar, Ghibli…). Streams filtern (CAM, 3D, 4K ausblenden), {{languages}} Sprachen und {{regions}} Regionen. Kostenlos, ohne Konto.',
        it: 'cataloghi Stremio: tendenze, novità, più votati, per piattaforma (Netflix, Disney+, Max, Hulu, AMC+…) e studio (Marvel, Pixar, Ghibli…). Filtra gli stream (nascondi CAM, 3D, 4K…), {{languages}} lingue e {{regions}} regioni. Gratis e senza account.',
      };
      var description = seo[toLanguage].replace('{{languages}}', String(DATA.catalogLanguageCount)).replace('{{regions}}', String(DATA.regions.length));
      return match[1] + ' ' + description;
    }
    match = text.match(/^(\\d+) catálogos por plataforma y estudio, fichas completas y streams filtrados a tu gusto\\. Gratis y sin cuenta\\.$/i);
    if (match) {
      var social = {
        es: 'catálogos por plataforma y estudio, fichas completas y streams filtrados a tu gusto. Gratis y sin cuenta.',
        en: 'catalogs by platform and studio, detailed title pages and streams filtered your way. Free, no account required.',
        pt: 'catálogos por plataforma e estúdio, fichas completas e streams filtrados do seu jeito. Grátis e sem conta.',
        fr: 'catalogues par plateforme et studio, fiches complètes et streams filtrés à votre goût. Gratuit, sans compte.',
        de: 'Kataloge nach Plattform und Studio, ausführliche Titelinfos und Streams nach Wunsch. Kostenlos und ohne Konto.',
        it: 'cataloghi per piattaforma e studio, schede complete e stream filtrati a modo tuo. Gratis e senza account.',
      };
      return match[1] + ' ' + social[toLanguage];
    }
    match = text.match(/^(\\d+) (idiomas|languages|línguas|langues|Sprachen|lingue) y (\\d+) (regiones|regions|regiões|régions|Regionen|regioni)\\./i);
    if (match) {
      var languageWord = { es: 'idiomas', en: 'languages', pt: 'idiomas', fr: 'langues', de: 'Sprachen', it: 'lingue' }[toLanguage];
      var regionWord = { es: 'regiones', en: 'regions', pt: 'regiões', fr: 'régions', de: 'Regionen', it: 'regioni' }[toLanguage];
      var andWord = { es: 'y', en: 'and', pt: 'e', fr: 'et', de: 'und', it: 'e' }[toLanguage];
      return match[1] + ' ' + languageWord + ' ' + andWord + ' ' + match[3] + ' ' + regionWord + '.';
    }
    match = text.match(/^(.+?) y luego (.+?) como respaldo$/i);
    if (match) {
      var firstCode = regionCodeFromName(match[1]);
      var secondCode = regionCodeFromName(match[2]);
      if (firstCode || secondCode) {
        var firstName = firstCode ? regionLabel(firstCode, toLanguage) : match[1];
        var secondName = secondCode ? regionLabel(secondCode, toLanguage) : match[2];
        return firstName + ' ' + phrase('y luego', toLanguage) + ' ' + secondName + ' ' + phrase('como respaldo', toLanguage);
      }
    }
    match = text.match(/^(más seeders|mejor calidad|menor tamaño)\\.$/i);
    if (text === 'desconectando…') return DATA.translations[toLanguage]['Desconectando…'];
    if (text === 'no conectado. opcional: los torrents públicos seguirán funcionando.') {
      return DATA.translations[toLanguage]['No conectado. Opcional: los torrents públicos seguirán funcionando.'];
    }
    if (text === 'opcional · sin conectar') return DATA.translations[toLanguage]['Opcional · sin conectar'];
    if (text === 'todo visible') return DATA.translations[toLanguage]['Todo visible'];
    var statusPhrases = [
      'Configuración debrid antigua detectada. Vuelve a conectar un proveedor para renovar la credencial de forma segura.',
      'Conectado a Real-Debrid mediante OAuth. Solo se muestran torrents completados de tu biblioteca personal; no se consulta la caché global ni se añaden torrents.',
      'Conectado a TorBox. Solo se añaden resultados tras un hit de caché y con add_only_if_cached=true; el elemento puede quedar en tu cuenta.',
      'Conectado a Premiumize. La consulta de caché es best-effort; la generación del enlace directo puede consumir fair-use.',
      'Conectado a EasyDebrid. Se genera un enlace solo después de confirmar el estado cacheado.',
    ];
    var statusSource = statusPhrases.find(function (candidate) { return normalize(candidate).toLowerCase() === text.toLowerCase(); });
    if (statusSource) return DATA.translations[toLanguage][statusSource] || statusSource;
    match = text.match(/^(no se oculta nada: verás todos los streams\\.|se ocultan: (.*?)\\.) orden: (.+?)(?:\\. tamaño máximo: (\\d+) gb\\.)?$/i);
    if (match) {
      var hiddenText = match[1].toLowerCase().startsWith('se ocultan:')
        ? phrase('Se ocultan:', toLanguage) + ' ' + match[2].split(', ').map(function (name) { return phrase(name, toLanguage); }).join(', ') + '.'
        : phrase('No se oculta nada: verás todos los streams.', toLanguage);
      var sortName = phrase(match[3][0].toUpperCase() + match[3].slice(1).toLowerCase(), toLanguage);
      var translated = hiddenText + ' ' + phrase('Orden:', toLanguage) + ' ' + sortName + '.';
      if (match[4]) translated += ' ' + phrase('Tamaño máximo:', toLanguage) + ' ' + match[4] + ' GB.';
      return translated;
    }
    match = text.match(/^has desmarcado todo en «(.+?)»: no quedará ningún stream que mostrar\\. deja al menos una opción marcada\\.$/i);
    if (match) {
      var groupNames = match[1].split('» y «');
      var groups = groupNames.map(function (name) { return phrase(name, toLanguage); });
      var joinedGroups = groups.length > 1 ? groups.slice(0, -1).join(', ') + ' ' + phrase('y', toLanguage) + ' ' + groups[groups.length - 1] : groups[0];
      return phrase('Has desmarcado todo en', toLanguage) + ' «' + joinedGroups + '»: ' + phrase('no quedará ningún stream que mostrar. Deja al menos una opción marcada.', toLanguage);
    }
    match = text.match(/^(\\d+) catálogos · (\\d+) proveedores · idioma (.+?) · región (.+?)(?: · (TorBox|EasyDebrid|Premiumize|Real-Debrid|Debrid))?(?: · (\\d+) filtros?)?$/i);
    if (match) {
      var details = [
        match[1] + ' ' + phrase('catálogos', toLanguage),
        match[2] + ' ' + phrase('Proveedores', toLanguage).toLowerCase(),
        phrase('Idioma', toLanguage) + ' ' + match[3],
        phrase('Región de plataformas', toLanguage) + ' ' + match[4],
      ];
      if (match[5]) details.push(match[5]);
      if (match[6]) details.push(match[6] + ' ' + phrase(Number(match[6]) === 1 ? 'filtro' : 'filtros', toLanguage));
      return details.join(' · ');
    }
    if (text.indexOf('catálogos') !== -1 && /\\bidioma\\b/.test(text) && /\\bregión\\b/.test(text)) {
      var parts = text.split(' · ');
      return parts.map(function (part) {
        var item = normalize(part);
        var m = item.match(/^(\\d+)\\s+(catálogos|proveedores|filtro|filtros)$/i);
        if (m) {
          var units = { catálogos: 'catálogos', proveedores: 'Proveedores', filtro: 'filtros', filtros: 'filtros' };
          return m[1] + ' ' + (DATA.translations[toLanguage][units[m[2].toLowerCase()]] || units[m[2].toLowerCase()]);
        }
        var translated = sourceFor(item, fromLanguage);
        return translated ? (DATA.translations[toLanguage][translated] || translated) : item;
      }).join(' · ');
    }
    return text;
  }
  function translateTextNode(node, fromLanguage, toLanguage) {
    if (!node || node.nodeType !== 3 || !node.parentElement) return;
    if (node.parentElement.closest('script,style,code,[translate="no"],[data-i18n-ignore]')) return;
    var current = node.nodeValue;
    var sourceRaw = originalText.has(node) ? originalText.get(node) : current;
    var source = normalize(sourceRaw);
    if (!source) return;
    var translated = translateDynamic(source, 'es', toLanguage);
    var output = translated === source ? sourceRaw : translated;
    if (output !== current) node.nodeValue = output;
    if (!originalText.has(node) && translated !== source) originalText.set(node, current);
  }
  function translateAttributes(element, fromLanguage, toLanguage) {
    if (!element || element.nodeType !== 1 || element.closest('script,style,[translate="no"],[data-i18n-ignore]')) return;
    var originals = originalAttributes.get(element) || Object.create(null);
    ['aria-label', 'placeholder', 'title', 'alt', 'content'].forEach(function (name) {
      if (!element.hasAttribute(name)) return;
      var current = element.getAttribute(name);
      var hasOriginal = Object.prototype.hasOwnProperty.call(originals, name);
      var source = hasOriginal ? originals[name] : current;
      var normalizedSource = normalize(source);
      var translated = translateDynamic(normalizedSource, 'es', toLanguage);
      var output = translated === normalizedSource && hasOriginal ? source : translated;
      if (output !== current) element.setAttribute(name, output);
      if (!hasOriginal && translated !== normalizedSource) originals[name] = current;
    });
    originalAttributes.set(element, originals);
  }
  function localizePickerNames(language) {
    var display;
    try { display = new Intl.DisplayNames([language], { type: 'language' }); } catch (_) { display = null; }
    document.querySelectorAll('.pill[data-group="region"]').forEach(function (pill) {
      var code = pill.dataset.value;
      var name = regionLabel(code, language);
      var nameNode = Array.from(pill.childNodes).find(function (node) { return node.nodeType === 3 && normalize(node.nodeValue); });
      if (nameNode && name && normalize(nameNode.nodeValue) !== name) nameNode.nodeValue = name;
      if (!pill.dataset.i18nSearchBase) pill.dataset.i18nSearchBase = pill.dataset.search || '';
      pill.dataset.search = [name, code, pill.dataset.i18nSearchBase].filter(Boolean).join(' ');
    });
    var selectedRegionCode = document.getElementById('regionCode');
    var selectedRegionName = document.getElementById('regionName');
    if (selectedRegionCode && selectedRegionName) {
      var selectedRegionLabel = regionLabel(normalize(selectedRegionCode.textContent), language);
      if (selectedRegionName.textContent !== selectedRegionLabel) selectedRegionName.textContent = selectedRegionLabel;
    }
    if (display) {
      document.querySelectorAll('.pill[data-group="lang"]').forEach(function (pill) {
        var code = pill.dataset.value;
        var bdi = pill.querySelector('bdi');
        if (!bdi) return;
        var small = pill.querySelector('small');
        if (small) small.hidden = language !== 'es';
        try {
          var label = display.of(code) || bdi.textContent;
          if (bdi.textContent !== label) bdi.textContent = label;
          pill.title = label;
        } catch (_) {}
        if (!pill.dataset.i18nSearchBase) pill.dataset.i18nSearchBase = pill.dataset.search || '';
        pill.dataset.search = [bdi.textContent, code, pill.dataset.i18nSearchBase].filter(Boolean).join(' ');
      });
      var selectedLanguageCode = document.getElementById('langCode');
      var selectedLanguageName = document.getElementById('langName');
      if (selectedLanguageCode && selectedLanguageName) {
        try {
          var selectedLanguageLabel = display.of(normalize(selectedLanguageCode.textContent)) || selectedLanguageName.textContent;
          if (selectedLanguageName.textContent !== selectedLanguageLabel) selectedLanguageName.textContent = selectedLanguageLabel;
        } catch (_) {}
      }
    }
    var languageCode = document.getElementById('langCode');
    var regionCode = document.getElementById('regionCode');
    if (languageCode && regionCode) {
      document.querySelectorAll('[data-sum=\"idioma\"]').forEach(function (summary) {
        var text = languageLabel(normalize(languageCode.textContent), language) + ' · ' + normalize(regionCode.textContent);
        if (summary.textContent !== text) summary.textContent = text;
      });
    }
  }
  function translateTree(node, fromLanguage, toLanguage) {
    if (!node) return;
    if (node.nodeType === 3) {
      translateTextNode(node, fromLanguage, toLanguage);
      return;
    }
    if (node.nodeType !== 1 && node.nodeType !== 9) return;
    translateAttributes(node, fromLanguage, toLanguage);
    Array.from(node.childNodes || []).forEach(function (child) { translateTree(child, fromLanguage, toLanguage); });
  }
  function languageSelect() { return document.querySelector('[data-web-language]'); }
  function setLanguage(language, fromLanguage) {
    if (LANGS.indexOf(language) === -1) language = 'es';
    var previous = fromLanguage || currentLanguage;
    currentLanguage = language;
    root.lang = language;
    translateTree(document.documentElement, previous, language);
    localizePickerNames(language);
    var select = languageSelect();
    if (select) select.value = override || 'auto';
  }
  function bindLanguageSelect() {
    var select = languageSelect();
    if (!select) return;
    select.value = override || 'auto';
    select.addEventListener('change', function () {
      var oldLanguage = currentLanguage;
      if (select.value === 'auto') {
        override = '';
        try { localStorage.removeItem(STORE_KEY); } catch (_) {}
        setLanguage(browserLanguage(), oldLanguage);
      } else if (LANGS.indexOf(select.value) !== -1) {
        override = select.value;
        try { localStorage.setItem(STORE_KEY, override); } catch (_) {}
        setLanguage(override, oldLanguage);
      }
    });
  }
  var observer = new MutationObserver(function (records) {
    records.forEach(function (record) {
      if (record.type === 'characterData') {
        translateTextNode(record.target, 'es', currentLanguage);
        if (record.target.parentElement && record.target.parentElement.closest('#langCode, #regionCode, #langName, #regionName')) localizePickerNames(currentLanguage);
      } else if (record.type === 'attributes') {
        translateAttributes(record.target, 'es', currentLanguage);
      } else {
        record.addedNodes.forEach(function (node) { translateTree(node, 'es', currentLanguage); });
        if (record.target.nodeType === 1 && (record.target.matches('[data-sum=\"idioma\"]') || ['langCode', 'langName', 'regionCode', 'regionName'].indexOf(record.target.id) !== -1)) {
          localizePickerNames(currentLanguage);
        }
      }
    });
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'placeholder', 'title', 'alt', 'content'] });
  function ready() {
    translateTree(document.documentElement, 'es', currentLanguage);
    localizePickerNames(currentLanguage);
    bindLanguageSelect();
    root.removeAttribute('data-i18n-pending');
  }
  document.addEventListener('DOMContentLoaded', ready, { once: true });
  window.setTimeout(function () { root.removeAttribute('data-i18n-pending'); }, 2500);
})();
`;

function detectWebLanguage(preferences) {
  const values = Array.isArray(preferences) ? preferences : [preferences];
  for (const value of values) {
    const language = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
    if (LANGUAGES.includes(language)) return language;
  }
  return 'es';
}

module.exports = { LANGUAGES, LANGUAGE_OPTIONS, PHRASES, TRANSLATIONS, WEB_I18N_BOOTSTRAP, WEB_I18N_SCRIPT, detectWebLanguage };
