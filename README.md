# Finanças da Família — Volta 1

App web instalável (PWA) para registar despesas partilhadas a 50/50 e ver sempre quem deve a quem.
Base de dados e login: Supabase. Alojamento: GitHub Pages. Custo: 0 €.

## Passo 1 — Base de dados (Supabase, ~5 min)

1. Em supabase.com, cria um projeto novo (região na Europa, por exemplo Frankfurt ou Ireland). Guarda a palavra-passe da base de dados.
2. Abre **SQL Editor → New query**, cola o conteúdo de `supabase/schema.sql` e carrega em **Run**. Deve terminar com "Success".

## Passo 2 — Contas (só vocês os dois)

1. Vai a **Authentication → Sign In / Providers** e desliga **Allow new users to sign up**. Assim mais ninguém consegue criar conta.
2. Vai a **Authentication → Users → Add user → Create new user**. Cria a tua conta (email + palavra-passe) com **Auto Confirm User** ligado. Repete para a Sónia.

## Passo 3 — Ligar cada conta ao nome

No **SQL Editor**, corre o seguinte, trocando os emails:

```sql
insert into public.members (user_id, name)
select id, 'André' from auth.users where email = 'EMAIL_DO_ANDRE';
insert into public.members (user_id, name)
select id, 'Sónia' from auth.users where email = 'EMAIL_DA_SONIA';
```

## Passo 4 — Configurar a app

Em **Project Settings → API Keys** (ou no botão **Connect**), copia o *Project URL* e a chave *anon / publishable* para o ficheiro `config.js`.

> Podes publicar esta chave sem problema: é pública por natureza. Quem protege os dados são as regras de segurança da base de dados (só os dois membros leem e escrevem) e o registo de novas contas desligado.

## Passo 5 — Publicar (GitHub Pages)

1. No GitHub, cria um repositório novo, por exemplo `financas`. Tem de ser **público** para o GitHub Pages ser gratuito.
2. Usa **Add file → Upload files** e arrasta todos os ficheiros desta pasta (incluindo `config.js` já preenchido). Depois carrega em **Commit**.
3. Vai a **Settings → Pages → Build and deployment**, escolhe *Deploy from a branch*, depois `main` e `/ (root)`, e carrega em **Save**.
4. Em 1 a 2 minutos a app fica em `https://<o-teu-utilizador>.github.io/financas/`.

## Passo 6 — Instalar nos telemóveis

- **iPhone (Safari):** abre o link, toca em Partilhar e depois em **Adicionar ao ecrã principal**.
- **Android (Chrome):** abre o link, toca no menu ⋮ e depois em **Instalar app**.

Cada um entra com a sua conta uma vez e a sessão fica guardada.

## Como funciona

- **+**: escreves a descrição e o valor. Fica registado como pago por quem tem a sessão iniciada, dividido a 50/50.
- **Conta conjunta**: liga o interruptor quando a despesa sai da conta conjunta. Conta para o resumo, mas não mexe no saldo.
- **Mais opções** (no registo): servem para mudar a data ou quem pagou.
- **Tocar numa despesa**: abre-a para editar ou apagar (qualquer um dos dois pode).
- **Registar acerto**: quando um paga ao outro. O valor vem preenchido com o saldo e dá para alterar se for um pagamento parcial. Para apagar um acerto, toca nele na lista.
- **Fixas**: as despesas recorrentes são lançadas automaticamente no dia do mês indicado, uma única vez por mês. Uma fixa criada depois do dia deste mês só começa no mês seguinte, por isso a deste mês regista-se à mão.
- O outro telemóvel atualiza sozinho quando alguém regista algo.

## Cuidados

- **Cópias de segurança:** o plano gratuito do Supabase não faz backups. Uma vez por mês, vai a **Table Editor → expenses → Export to CSV**. Uma exportação automática fica para uma próxima volta.
- **Pausa por inatividade:** o Supabase pausa projetos gratuitos ao fim de 1 semana sem uso. Com uso diário isso não acontece. Se acontecer, os dados ficam guardados e basta carregar em **Resume project** no painel.
- **Atualizar a app:** depois de substituir ficheiros no GitHub, muda `financas-v1` para `financas-v2` em `sw.js`, para os telemóveis receberem a versão nova.
