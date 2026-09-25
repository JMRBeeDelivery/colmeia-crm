-- Colmeia CRM · dados iniciais (estrutura comercial de setembro/2026)
-- Preencha o e-mail @bee.com.br de cada pessoa (coluna email) antes de convidar a equipe.
-- O gestor já vem cadastrado com comercial.claude@bee.com.br.
begin;

insert into public.regionais (id, nome) values
  ('r1', 'Regional 1'),
  ('r2', 'Regional 2')
on conflict (id) do update set nome = excluded.nome;

insert into public.pessoas (id, nome, email, papel, regional_id) values
  ('gestao-comercial', 'Gestão Comercial', 'comercial.claude@bee.com.br', 'gestor', null),
  ('ana-paula-neves-de-azevedo', 'Ana Paula Neves de Azevedo', null, 'supervisor', 'r2'),
  ('lucas-pacheco', 'Lucas Pacheco', null, 'supervisor', 'r1'),
  ('bruno-batista', 'Bruno Batista', null, 'comercial', 'r1'),
  ('euclides-junior', 'Euclides Junior', null, 'comercial', 'r1'),
  ('franciele-arantes-miranda', 'Franciele Arantes Miranda', null, 'comercial', 'r1'),
  ('genilson-anchieta', 'Genilson Anchieta', null, 'comercial', 'r1'),
  ('heraclio-cesar', 'Heraclio Cesar', null, 'comercial', 'r1'),
  ('jose-willian', 'Jose Willian', null, 'comercial', 'r1'),
  ('joao-felipe-da-silva-guedes', 'João Felipe da Silva Guedes', null, 'comercial', 'r1'),
  ('juan-marinho', 'Juan Marinho', null, 'comercial', 'r1'),
  ('adimael-lima', 'Adimael Lima', null, 'comercial', 'r2'),
  ('altanir-muzi', 'Altanir Muzi', null, 'comercial', 'r2'),
  ('andre-luiz-dos-santos', 'André Luiz dos Santos', null, 'comercial', 'r2'),
  ('camila-atayde', 'Camila Atayde', null, 'comercial', 'r2'),
  ('camila-de-jesus-rezende', 'Camila de Jesus Rezende', null, 'comercial', 'r2'),
  ('gilberto-benicio-de-melo-junior', 'Gilberto Benicio de Melo Junior', null, 'comercial', 'r2'),
  ('jeanne-araujo-chermont', 'Jeanne Araújo Chermont', null, 'comercial', 'r2'),
  ('joverland-miranda-de-oliveira', 'Joverland Miranda de Oliveira', null, 'comercial', 'r2'),
  ('melquezedeque-dos-anjos-barbosa', 'Melquezedeque dos Anjos Barbosa', null, 'comercial', 'r2'),
  ('rhuan-ferreira-caetano', 'Rhuan Ferreira Caetano', null, 'comercial', 'r2')
on conflict (id) do update set nome = excluded.nome, papel = excluded.papel, regional_id = excluded.regional_id;

update public.regionais r set supervisor_id = v.s from (values ('r1', 'lucas-pacheco'), ('r2', 'ana-paula-neves-de-azevedo')) as v(id, s) where r.id = v.id;

insert into public.pracas (id, nome, uf, rotulo, aliases, regional_id, comercial_id, meta, produzido, produzido_ate) values
  ('natal-rn', 'Natal', 'RN', 'Natal/RN', '{}', 'r1', 'euclides-junior', 28618, 13268, '2026-09-16'),
  ('recife-pe', 'Recife', 'PE', 'Recife/PE', '{}', 'r1', 'juan-marinho', 15558, 7620, '2026-09-16'),
  ('joao-pessoa-pb', 'João Pessoa', 'PB', 'João Pessoa/PB', '{}', 'r1', 'joao-felipe-da-silva-guedes', 7508, 3897, '2026-09-16'),
  ('aracaju-se', 'Aracaju', 'SE', 'Aracaju/SE', '{}', 'r1', 'genilson-anchieta', 5414, 2458, '2026-09-16'),
  ('caldas-novas-go', 'Caldas Novas', 'GO', 'Caldas Novas/GO', '{}', 'r1', 'bruno-batista', 4998, 2391, '2026-09-16'),
  ('mossoro-rn', 'Mossoró', 'RN', 'Mossoró/RN', '{}', 'r1', 'heraclio-cesar', 1937, 759, '2026-09-16'),
  ('campina-grande-pb', 'Campina Grande', 'PB', 'Campina Grande/PB', '{}', 'r1', 'jose-willian', 1003, 509, '2026-09-16'),
  ('olinda-pe', 'Olinda', 'PE', 'Olinda/PE', '{}', 'r1', 'juan-marinho', 716, 393, '2026-09-16'),
  ('rondonopolis-mt', 'Rondonópolis', 'MT', 'Rondonópolis/MT', '{}', 'r1', 'franciele-arantes-miranda', 475, 199, '2026-09-16'),
  ('sorriso-mt', 'Sorriso', 'MT', 'Sorriso/MT', '{}', 'r1', 'franciele-arantes-miranda', 264, 94, '2026-09-16'),
  ('tangara-da-serra-mt', 'Tangará da Serra', 'MT', 'Tangará da Serra/MT', '{}', 'r1', 'franciele-arantes-miranda', 121, 166, '2026-09-16'),
  ('sinop-mt', 'Sinop', 'MT', 'Sinop/MT', '{}', 'r1', 'franciele-arantes-miranda', null, 0, '2026-09-16'),
  ('cuiaba-varzea-grande-mt', 'Cuiabá–Várzea Grande', 'MT', 'Cuiabá–Várzea Grande/MT', '{Cuiabá,Várzea Grande}', 'r1', 'franciele-arantes-miranda', null, 0, '2026-09-16'),
  ('manaus-am', 'Manaus', 'AM', 'Manaus/AM', '{}', 'r2', 'joverland-miranda-de-oliveira', 28831, 11880, '2026-09-16'),
  ('boa-vista-rr', 'Boa Vista', 'RR', 'Boa Vista/RR', '{}', 'r2', 'adimael-lima', 15969, 7355, '2026-09-16'),
  ('belem-ananindeua-pa', 'Belém–Ananindeua', 'PA', 'Belém–Ananindeua/PA', '{Belém,Ananindeua}', 'r2', 'camila-de-jesus-rezende', 7461, 2965, '2026-09-16'),
  ('rio-branco-ac', 'Rio Branco', 'AC', 'Rio Branco/AC', '{}', 'r2', 'gilberto-benicio-de-melo-junior', 5875, 2317, '2026-09-16'),
  ('maceio-al', 'Maceió', 'AL', 'Maceió/AL', '{}', 'r2', 'camila-atayde', 1893, 940, '2026-09-16'),
  ('macae-rj', 'Macaé', 'RJ', 'Macaé/RJ', '{}', 'r2', 'rhuan-ferreira-caetano', 1391, 557, '2026-09-16'),
  ('brasilia-df', 'Brasília', 'DF', 'Brasília/DF', '{}', 'r2', 'altanir-muzi', 784, 362, '2026-09-16'),
  ('macapa-ap', 'Macapá', 'AP', 'Macapá/AP', '{}', 'r2', 'jeanne-araujo-chermont', 700, 436, '2026-09-16'),
  ('campos-dos-goytacazes-rj', 'Campos dos Goytacazes', 'RJ', 'Campos dos Goytacazes/RJ', '{}', 'r2', 'rhuan-ferreira-caetano', 398, 165, '2026-09-16'),
  ('americana-sp', 'Americana', 'SP', 'Americana/SP', '{}', 'r2', 'andre-luiz-dos-santos', 100, 12, '2026-09-16'),
  ('araraquara-sp', 'Araraquara', 'SP', 'Araraquara/SP', '{}', 'r2', 'melquezedeque-dos-anjos-barbosa', 89, 47, '2026-09-16'),
  ('rio-das-ostras-rj', 'Rio das Ostras', 'RJ', 'Rio das Ostras/RJ', '{}', 'r2', 'rhuan-ferreira-caetano', 77, 15, '2026-09-16'),
  ('luziania-valparaiso-go', 'Luziânia–Valparaíso', 'GO', 'Luziânia–Valparaíso/GO', '{Luziânia,Valparaíso de Goiás,Valparaíso}', 'r2', 'melquezedeque-dos-anjos-barbosa', 45, 0, '2026-09-16'),
  ('cacapava-sp', 'Caçapava', 'SP', 'Caçapava/SP', '{}', 'r2', 'melquezedeque-dos-anjos-barbosa', null, 22, '2026-09-16'),
  ('goiania-go', 'Goiânia', 'GO', 'Goiânia/GO', '{}', 'r2', 'melquezedeque-dos-anjos-barbosa', null, 7, '2026-09-16'),
  ('ribeirao-preto-sp', 'Ribeirão Preto', 'SP', 'Ribeirão Preto/SP', '{}', 'r2', 'melquezedeque-dos-anjos-barbosa', null, 4, '2026-09-16'),
  ('marilia-sp', 'Marília', 'SP', 'Marília/SP', '{}', 'r2', 'melquezedeque-dos-anjos-barbosa', null, 3, '2026-09-16'),
  ('jundiai-sp', 'Jundiaí', 'SP', 'Jundiaí/SP', '{}', 'r2', 'melquezedeque-dos-anjos-barbosa', null, 0, '2026-09-16'),
  ('juiz-de-fora-mg', 'Juiz de Fora', 'MG', 'Juiz de Fora/MG', '{}', 'r2', 'melquezedeque-dos-anjos-barbosa', null, 0, '2026-09-16'),
  ('sao-paulo-sp', 'São Paulo', 'SP', 'São Paulo/SP', '{}', 'r2', 'melquezedeque-dos-anjos-barbosa', null, 0, '2026-09-16'),
  ('presidente-prudente-sp', 'Presidente Prudente', 'SP', 'Presidente Prudente/SP', '{}', null, null, null, 0, '2026-09-16'),
  ('campo-grande-ms', 'Campo Grande', 'MS', 'Campo Grande/MS', '{}', null, null, null, 0, '2026-09-16'),
  ('curitiba-pr', 'Curitiba', 'PR', 'Curitiba/PR', '{}', null, null, null, 0, '2026-09-16'),
  ('primavera-do-leste-mt', 'Primavera do Leste', 'MT', 'Primavera do Leste/MT', '{}', null, null, null, 0, '2026-09-16'),
  ('vitoria-da-conquista-ba', 'Vitória da Conquista', 'BA', 'Vitória da Conquista/BA', '{}', null, null, null, 0, '2026-09-16'),
  ('guarulhos-sp', 'Guarulhos', 'SP', 'Guarulhos/SP', '{}', null, null, null, 0, '2026-09-16')
on conflict (id) do update set nome = excluded.nome, uf = excluded.uf, rotulo = excluded.rotulo, aliases = excluded.aliases,
  regional_id = excluded.regional_id, comercial_id = excluded.comercial_id, meta = excluded.meta,
  produzido = excluded.produzido, produzido_ate = excluded.produzido_ate;

commit;
