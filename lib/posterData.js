'use strict';

/**
 * Posters de referencia (TMDB CDN público — no requieren clave).
 * Usados como fallback del rail "Tendencias" cuando TMDB_API_KEY no está
 * configurada o TMDB no responde. Con clave, el rail se sirve en vivo (6h caché).
 */

const IMG = 'https://image.tmdb.org/t/p/w500/';

const STATIC_TRENDING_MOVIES = [
  { title: 'The Odyssey', year: '2026', rating: '8.0', poster: `${IMG}5rhTDKUhPYvpdQIijFIs5VoWsON.jpg` },
  { title: 'Godzilla Minus Zero', year: '2026', rating: '8.0', poster: `${IMG}hSmIJluOJmTWvJs4d7kHRxjc8s8.jpg` },
  { title: 'Demon Slayer: Infinity Castle', year: '2025', rating: '8.8', poster: `${IMG}fWVSwgjpT2D78VUh6X8UBd2rorW.jpg` },
  { title: "Spider-Man: Brand New Day", year: '2026', rating: '8.5', poster: `${IMG}bjiS5ipwxb9JFy3XRRN4OAilSeX.jpg` },
  { title: 'Dune: Part Three', year: '2026', rating: '', poster: `${IMG}glt0v4I89rMWstDNCaFXc5SNyO1.jpg` },
  { title: 'Avengers: Doomsday', year: '2026', rating: '', poster: `${IMG}9jlZ59UALLLOE279HMT19rP9XQs.jpg` },
  { title: 'Resident Evil', year: '2026', rating: '7.5', poster: `${IMG}gAgWJhUSQWCgtKR8170nMkYlBda.jpg` },
  { title: 'Heart of the Beast', year: '2026', rating: '7.3', poster: `${IMG}6sYemVUn79UPKz1ZsSG6kPU4RVy.jpg` },
  { title: 'Wild Horse Nine', year: '2026', rating: '8.1', poster: `${IMG}dNJFRtVg3xLQ7dbNIQ55cmmIniD.jpg` },
  { title: 'Top Gun: Maverick', year: '2022', rating: '8.2', poster: `${IMG}n0YuM4f5lvGAP6MAW2kBIzugXnc.jpg` },
  { title: 'Spider-Man: Into the Spider-Verse', year: '2018', rating: '8.4', poster: `${IMG}iiZZdoQBEYBv6id8su7ImL0oCbD.jpg` },
  { title: 'Whiplash', year: '2014', rating: '8.4', poster: `${IMG}7fn624j5lj3xTme2SgiLCeuedmO.jpg` },
  { title: 'Gladiator', year: '2000', rating: '8.2', poster: `${IMG}aDb548BOkFfI4nFm0kx8A3Ezh7H.jpg` },
  { title: 'Possible Love', year: '2026', rating: '7.4', poster: `${IMG}1ERGPNiKtnEcsvJS1ywsmqmcIDO.jpg` },
];

const STATIC_TRENDING_SERIES = [
  { title: 'MobLand', year: '2025', rating: '8.6', poster: `${IMG}5Xc7WpWsgflfgEMoBlf9TmWhfbH.jpg` },
  { title: 'The Apothecary Diaries', year: '2023', rating: '8.7', poster: `${IMG}sJZcy8QsOPuRPiCfoCWVB3r9Ohg.jpg` },
  { title: 'Dexter: Resurrection', year: '2025', rating: '8.6', poster: `${IMG}o2Oyi3boT100bY5kCP4MBiTeetO.jpg` },
  { title: 'The Silent Storm', year: '2026', rating: '9.0', poster: `${IMG}c8UHaCOfzyQYagHv7vAAOkrmgDb.jpg` },
  { title: 'VisionQuest', year: '2026', rating: '8.6', poster: `${IMG}WGyAyBPncfuu8MZhLY9RtfZPM0.jpg` },
  { title: 'Campus Drivers', year: '2026', rating: '8.1', poster: `${IMG}1vqJ8kNCz91C2fUpXSma7oAWCc5.jpg` },
  { title: 'Re:ZERO -Starting Life in Another World-', year: '2016', rating: '8.1', poster: `${IMG}oHqYrPAsIiTD5m4DuxumV4er8BU.jpg` },
  { title: 'The Rules', year: '2026', rating: '8.5', poster: `${IMG}cFabmj843vjeN2X0L2FGLKlSbG1.jpg` },
  { title: 'Lupin', year: '2021', rating: '7.7', poster: `${IMG}h6Z2oogE4mJk2uffdtIlLhb0EHx.jpg` },
  { title: 'The Gilded Age', year: '2022', rating: '7.7', poster: `${IMG}tdsuFe0JVLqjxfptElRA9YFJcUE.jpg` },
  { title: 'The Lord of the Rings: The Rings of Power', year: '2022', rating: '7.2', poster: `${IMG}bMXWXKM9ydUmMTNvDnYo9QtCBRt.jpg` },
  { title: 'Black Doves', year: '2024', rating: '7.0', poster: `${IMG}srlsyEfIBz2MNWBndVc3opOaNGS.jpg` },
  { title: 'The Institute', year: '2025', rating: '7.5', poster: `${IMG}4MwXkOAMd9ObxdacasPFM32n9dZ.jpg` },
];

module.exports = { STATIC_TRENDING_MOVIES, STATIC_TRENDING_SERIES };
