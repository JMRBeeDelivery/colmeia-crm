-- =====================================================================
-- Colmeia CRM · estrutura comercial de outubro/2026
-- Fonte: planilha de metas, aba de cidades (CIDADE · SUPERVISOR · COMERCIAL), lida em 09/10/2026.
-- Rode no SQL Editor do Supabase. Pode rodar de novo: grava o estado final, não acumula.
-- Não mexe em metas, produzido nem e-mails.
-- =====================================================================
begin;

-- Comercial nova (Caldas Novas). O e-mail entra pela aba Gestão, que já cria o login com a senha inicial.
insert into public.pessoas (id, nome, email, papel, regional_id) values
  ('cristiele-rocha', 'Cristiele Rocha', null, 'comercial', 'r1')
on conflict (id) do update set nome = excluded.nome, papel = excluded.papel, regional_id = excluded.regional_id, ativo = true;

-- Supervisão: r1 = Lucas Pacheco, r2 = Ana Paula
update public.regionais r set supervisor_id = v.s
from (values ('r1', 'lucas-pacheco'), ('r2', 'ana-paula-neves-de-azevedo')) as v(id, s) where r.id = v.id;

-- Praça → regional e comercial, exatamente como na planilha (39 cidades)
do $$
declare n int;
begin
  update public.pracas p set regional_id = v.regional_id, comercial_id = v.comercial_id
  from (values
    -- Regional 1 · Lucas Pacheco
    ('aracaju-se',               'r1', 'genilson-anchieta'),
    ('caldas-novas-go',          'r1', 'cristiele-rocha'),
    ('campina-grande-pb',        'r1', 'lucas-pacheco'),
    ('cuiaba-varzea-grande-mt',  'r1', 'franciele-arantes-miranda'),
    ('joao-pessoa-pb',           'r1', 'joao-felipe-da-silva-guedes'),
    ('mossoro-rn',               'r1', 'heraclio-cesar'),
    ('natal-rn',                 'r1', 'euclides-junior'),
    ('olinda-pe',                'r1', 'juan-marinho'),
    ('primavera-do-leste-mt',    'r1', 'franciele-arantes-miranda'),
    ('recife-pe',                'r1', 'juan-marinho'),
    ('rondonopolis-mt',          'r1', 'franciele-arantes-miranda'),
    ('sinop-mt',                 'r1', 'franciele-arantes-miranda'),
    ('sorriso-mt',               'r1', 'franciele-arantes-miranda'),
    ('tangara-da-serra-mt',      'r1', 'franciele-arantes-miranda'),
    -- Regional 2 · Ana Paula Neves de Azevedo
    ('americana-sp',             'r2', 'andre-luiz-dos-santos'),
    ('araraquara-sp',            'r2', 'andre-luiz-dos-santos'),
    ('belem-ananindeua-pa',      'r2', 'camila-de-jesus-rezende'),
    ('boa-vista-rr',             'r2', 'adimael-lima'),
    ('brasilia-df',              'r2', 'altanir-muzi'),
    ('cacapava-sp',              'r2', 'andre-luiz-dos-santos'),
    ('campos-dos-goytacazes-rj', 'r2', 'melquezedeque-dos-anjos-barbosa'),
    ('goiania-go',               'r2', 'altanir-muzi'),
    ('guarulhos-sp',             'r2', 'andre-luiz-dos-santos'),
    ('juiz-de-fora-mg',          'r2', 'melquezedeque-dos-anjos-barbosa'),
    ('jundiai-sp',               'r2', 'andre-luiz-dos-santos'),
    ('luziania-valparaiso-go',   'r2', 'altanir-muzi'),
    ('macae-rj',                 'r2', 'melquezedeque-dos-anjos-barbosa'),
    ('macapa-ap',                'r2', 'jeanne-araujo-chermont'),
    ('maceio-al',                'r2', 'camila-atayde'),
    ('manaus-am',                'r2', 'joverland-miranda-de-oliveira'),
    ('marilia-sp',               'r2', 'andre-luiz-dos-santos'),
    ('presidente-prudente-sp',   'r2', 'andre-luiz-dos-santos'),
    ('ribeirao-preto-sp',        'r2', 'andre-luiz-dos-santos'),
    ('rio-branco-ac',            'r2', 'gilberto-benicio-de-melo-junior'),
    ('rio-das-ostras-rj',        'r2', 'melquezedeque-dos-anjos-barbosa'),
    ('sao-paulo-sp',             'r2', 'andre-luiz-dos-santos'),
    -- Sem supervisor e sem comercial
    ('campo-grande-ms',          null, null),
    ('curitiba-pr',              null, null),
    ('vitoria-da-conquista-ba',  null, null)
  ) as v(id, regional_id, comercial_id)
  where p.id = v.id;
  get diagnostics n = row_count;
  if n <> 39 then raise exception 'Esperava atualizar 39 praças, atualizou %. Nada foi gravado.', n; end if;
end $$;

-- Fora da lista da planilha: Bruno Batista, Jose Willian e Rhuan Ferreira Caetano.
-- Desativar corta o acesso ao CRM; para desfazer, use "Reativar" na aba Gestão.
update public.pessoas set ativo = false where id in ('bruno-batista', 'jose-willian', 'rhuan-ferreira-caetano');

-- Cabo Frio não está na planilha e era do Rhuan: fica sem comercial até o gestor definir.
-- (Piracicaba também não está na planilha e continua com o André.)
update public.pracas set comercial_id = null where id = 'cabo-frio-rj' and comercial_id = 'rhuan-ferreira-caetano';

-- Conferência
select coalesce(r.nome, 'Sem regional') as regional, s.nome as supervisor, pr.rotulo as praca,
       coalesce(c.nome, '— sem comercial —') as comercial
from public.pracas pr
left join public.regionais r on r.id = pr.regional_id
left join public.pessoas s on s.id = r.supervisor_id
left join public.pessoas c on c.id = pr.comercial_id
order by regional, comercial, praca;

commit;
