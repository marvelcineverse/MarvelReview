insert into public.films (title, type, release_date, poster_url)
values
  ('Iron Man', 'movie', '2008-05-02', 'https://image.tmdb.org/t/p/w500/78lPtwv72eTNqFW9COBYI0dWDJa.jpg'),
  ('The Avengers', 'movie', '2012-04-25', 'https://image.tmdb.org/t/p/w500/RYMX2wcKCBAr24UyPD7xwmjaTn.jpg'),
  ('Captain America: The Winter Soldier', 'movie', '2014-03-26', 'https://image.tmdb.org/t/p/w500/tVFRpFw3xTedgPGqxW0AOI8Qhh0.jpg'),
  ('Guardians of the Galaxy', 'movie', '2014-07-30', 'https://image.tmdb.org/t/p/w500/r7vmZjiyZw9rpJMQJdXpjgiCOk9.jpg'),
  ('Black Panther', 'movie', '2018-02-13', 'https://image.tmdb.org/t/p/w500/uxzzxijgPIY7slzFvMotPv8wjKA.jpg'),
  ('Avengers: Endgame', 'movie', '2019-04-24', 'https://image.tmdb.org/t/p/w500/or06FN3Dka5tukK1e9sl16pB3iy.jpg'),
  ('WandaVision', 'series', '2021-01-15', 'https://image.tmdb.org/t/p/w500/frobUz2X5Pc8OiVZU8Oo5K3NKMM.jpg'),
  ('Loki', 'series', '2021-06-09', 'https://image.tmdb.org/t/p/w500/kEl2t3OhXc3Zb9FBh1AuYzRTgZp.jpg'),
  ('Moon Knight', 'series', '2022-03-30', 'https://image.tmdb.org/t/p/w500/9fAc9nhHVDM0fpr8Y9N6nq5Y0R.jpg'),
  ('Ms. Marvel', 'series', '2022-06-08', 'https://image.tmdb.org/t/p/w500/8jXgXjYQe7x4Y4nHCqB6f0GO6dJ.jpg')
on conflict do nothing;
