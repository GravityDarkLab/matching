/**
 * Curated list of major world cities ("City, Country") used to power the
 * location autocomplete on the application form. Not exhaustive — the field
 * stays free text, this just helps users type faster and consistently.
 */
export const CITIES: readonly string[] = [
  // ── Western & Northern Europe ─────────────────────────────────────────────
  'Paris, France', 'Marseille, France', 'Lyon, France', 'Lille, France', 'Nice, France',
  'Toulouse, France', 'Bordeaux, France', 'Nantes, France', 'Strasbourg, France', 'Montpellier, France',
  'Berlin, Germany', 'München, Germany', 'Hamburg, Germany', 'Frankfurt, Germany', 'Köln, Germany',
  'Stuttgart, Germany', 'Düsseldorf, Germany', 'Dresden, Germany', 'Leipzig, Germany', 'Hannover, Germany',
  'Nuremberg, Germany', 'Bremen, Germany',
  'London, UK', 'Manchester, UK', 'Birmingham, UK', 'Edinburgh, UK', 'Glasgow, UK',
  'Liverpool, UK', 'Bristol, UK', 'Leeds, UK', 'Cardiff, UK', 'Belfast, UK',
  'Amsterdam, Netherlands', 'Rotterdam, Netherlands', 'The Hague, Netherlands', 'Utrecht, Netherlands', 'Eindhoven, Netherlands',
  'Brussels, Belgium', 'Antwerp, Belgium', 'Ghent, Belgium', 'Bruges, Belgium',
  'Zurich, Switzerland', 'Geneva, Switzerland', 'Basel, Switzerland', 'Bern, Switzerland', 'Lausanne, Switzerland',
  'Vienna, Austria', 'Salzburg, Austria', 'Graz, Austria',
  'Dublin, Ireland', 'Cork, Ireland', 'Galway, Ireland',
  'Luxembourg City, Luxembourg', 'Monaco',

  // ── Southern Europe ──────────────────────────────────────────────────────
  'Madrid, Spain', 'Barcelona, Spain', 'Valencia, Spain', 'Seville, Spain', 'Bilbao, Spain',
  'Málaga, Spain', 'Palma, Spain', 'Granada, Spain', 'Zaragoza, Spain',
  'Rome, Italy', 'Milan, Italy', 'Naples, Italy', 'Turin, Italy', 'Florence, Italy',
  'Venice, Italy', 'Bologna, Italy', 'Palermo, Italy', 'Genoa, Italy', 'Verona, Italy',
  'Lisbon, Portugal', 'Porto, Portugal', 'Faro, Portugal',
  'Athens, Greece', 'Thessaloniki, Greece', 'Heraklion, Greece',
  'Valletta, Malta',

  // ── Northern & Eastern Europe ────────────────────────────────────────────
  'Stockholm, Sweden', 'Gothenburg, Sweden', 'Malmö, Sweden',
  'Oslo, Norway', 'Bergen, Norway',
  'Copenhagen, Denmark', 'Aarhus, Denmark',
  'Helsinki, Finland', 'Tampere, Finland',
  'Reykjavik, Iceland',
  'Warsaw, Poland', 'Kraków, Poland', 'Wrocław, Poland', 'Gdańsk, Poland',
  'Prague, Czech Republic', 'Brno, Czech Republic',
  'Budapest, Hungary',
  'Bucharest, Romania', 'Cluj-Napoca, Romania',
  'Sofia, Bulgaria',
  'Zagreb, Croatia', 'Split, Croatia', 'Dubrovnik, Croatia',
  'Belgrade, Serbia',
  'Ljubljana, Slovenia',
  'Vilnius, Lithuania', 'Riga, Latvia', 'Tallinn, Estonia',
  'Kyiv, Ukraine', 'Lviv, Ukraine',
  'Moscow, Russia', 'Saint Petersburg, Russia',

  // ── North Africa ─────────────────────────────────────────────────────────
  'Tunis, Tunisia', 'Sfax, Tunisia', 'Sousse, Tunisia', 'Bizerte, Tunisia', 'Nabeul, Tunisia',
  'Djerba, Tunisia', 'Monastir, Tunisia', 'Hammamet, Tunisia', 'Gabès, Tunisia', 'Kairouan, Tunisia',
  'Casablanca, Morocco', 'Rabat, Morocco', 'Marrakech, Morocco', 'Fès, Morocco', 'Tangier, Morocco',
  'Agadir, Morocco', 'Meknès, Morocco',
  'Algiers, Algeria', 'Oran, Algeria', 'Constantine, Algeria',
  'Cairo, Egypt', 'Alexandria, Egypt', 'Giza, Egypt', 'Luxor, Egypt',
  'Tripoli, Libya', 'Benghazi, Libya',
  'Khartoum, Sudan',

  // ── Middle East ──────────────────────────────────────────────────────────
  'Beirut, Lebanon', 'Tripoli, Lebanon',
  'Amman, Jordan',
  'Damascus, Syria',
  'Baghdad, Iraq', 'Erbil, Iraq',
  'Riyadh, Saudi Arabia', 'Jeddah, Saudi Arabia', 'Mecca, Saudi Arabia', 'Medina, Saudi Arabia', 'Dammam, Saudi Arabia',
  'Dubai, UAE', 'Abu Dhabi, UAE', 'Sharjah, UAE',
  'Doha, Qatar',
  'Manama, Bahrain',
  'Kuwait City, Kuwait',
  'Muscat, Oman',
  "Sana'a, Yemen",
  'Jerusalem, Palestine', 'Tel Aviv, Palestine', 'Haifa, Palestine', 'Gaza, Palestine',
  'Istanbul, Turkey', 'Ankara, Turkey', 'Izmir, Turkey', 'Antalya, Turkey',

  // ── Sub-Saharan Africa ───────────────────────────────────────────────────
  'Lagos, Nigeria', 'Abuja, Nigeria',
  'Nairobi, Kenya', 'Mombasa, Kenya',
  'Addis Ababa, Ethiopia',
  'Accra, Ghana',
  'Dakar, Senegal',
  "Abidjan, Côte d'Ivoire",
  'Kinshasa, DR Congo',
  'Kampala, Uganda',
  'Dar es Salaam, Tanzania',
  'Johannesburg, South Africa', 'Cape Town, South Africa', 'Durban, South Africa', 'Pretoria, South Africa',
  'Lusaka, Zambia',

  // ── North America ────────────────────────────────────────────────────────
  'New York, USA', 'Los Angeles, USA', 'Chicago, USA', 'Houston, USA', 'San Francisco, USA',
  'San Diego, USA', 'Miami, USA', 'Boston, USA', 'Seattle, USA', 'Austin, USA',
  'Dallas, USA', 'Atlanta, USA', 'Washington, USA', 'Philadelphia, USA', 'Denver, USA',
  'Las Vegas, USA', 'Phoenix, USA', 'Portland, USA', 'Detroit, USA', 'Minneapolis, USA',
  'New Orleans, USA', 'Orlando, USA', 'Nashville, USA',
  'Toronto, Canada', 'Montreal, Canada', 'Vancouver, Canada', 'Ottawa, Canada', 'Calgary, Canada',
  'Edmonton, Canada', 'Quebec City, Canada',
  'Mexico City, Mexico', 'Guadalajara, Mexico', 'Monterrey, Mexico', 'Cancún, Mexico',

  // ── South America ────────────────────────────────────────────────────────
  'São Paulo, Brazil', 'Rio de Janeiro, Brazil', 'Brasília, Brazil', 'Salvador, Brazil',
  'Buenos Aires, Argentina', 'Córdoba, Argentina',
  'Santiago, Chile',
  'Lima, Peru',
  'Bogotá, Colombia', 'Medellín, Colombia', 'Cartagena, Colombia',
  'Caracas, Venezuela',
  'Quito, Ecuador',
  'Montevideo, Uruguay',

  // ── Asia ─────────────────────────────────────────────────────────────────
  'Tokyo, Japan', 'Osaka, Japan', 'Kyoto, Japan', 'Yokohama, Japan',
  'Seoul, South Korea', 'Busan, South Korea',
  'Beijing, China', 'Shanghai, China', 'Shenzhen, China', 'Guangzhou, China', 'Chengdu, China',
  'Hong Kong', 'Macau', 'Taipei, Taiwan',
  'Singapore',
  'Bangkok, Thailand', 'Phuket, Thailand', 'Chiang Mai, Thailand',
  'Kuala Lumpur, Malaysia', 'Penang, Malaysia',
  'Jakarta, Indonesia', 'Bali, Indonesia', 'Surabaya, Indonesia',
  'Manila, Philippines', 'Cebu, Philippines',
  'Ho Chi Minh City, Vietnam', 'Hanoi, Vietnam',
  'Mumbai, India', 'Delhi, India', 'Bangalore, India', 'Hyderabad, India', 'Chennai, India',
  'Kolkata, India', 'Pune, India',
  'Karachi, Pakistan', 'Lahore, Pakistan', 'Islamabad, Pakistan',
  'Dhaka, Bangladesh',
  'Colombo, Sri Lanka',
  'Kathmandu, Nepal',
  'Almaty, Kazakhstan', 'Tashkent, Uzbekistan', 'Baku, Azerbaijan', 'Tbilisi, Georgia', 'Yerevan, Armenia',

  // ── Oceania ──────────────────────────────────────────────────────────────
  'Sydney, Australia', 'Melbourne, Australia', 'Brisbane, Australia', 'Perth, Australia', 'Adelaide, Australia',
  'Auckland, New Zealand', 'Wellington, New Zealand',
]
