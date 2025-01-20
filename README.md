# Projeto de Casamento - README

## Instruções para Configuração e Uso

### 1. Instalação dos Pacotes
Utilize o comando abaixo para instalar os pacotes descritos no arquivo `package.json`:
'''bash
npm install
'''
### 2. Executar o Projeto Localmente
Para rodar o projeto localmente, utilize o comando:
```bash
gulp
```
O site estará disponível no endereço `http://localhost:8080`.

### 3. Deploy em Ambiente de Produção
- O deploy do container em ambiente de produção foi realizado utilizando o **Cloud Run** do Google Cloud.
- Um **IP estático** foi associado a um domínio personalizado com o nome do casal, criando um endereço mais atrativo para divulgação.

### 4. Armazenamento de Arquivos
- Os arquivos SQLite, que mostram as compras dos usuários de forma detalhada, estão armazenados no **Google Drive**.

### 5. Gestão via Planilha ADMIN
- Foi criada uma planilha **ADMIN** utilizando a **API do Google Sheets**.
- Essa planilha permite ao casal:
  - Gerir convidados que confirmaram presença.
  - Acompanhar presentes comprados.
  - Visualizar mensagens deixadas pelos convidados.
- A integração foi feita através do **Google App Scripts**, extensão do Google Sheets.
- O script utilizado pode ser encontrado no arquivo `appscriptgoogle`, localizado na raiz do repositório.

### 6. Atualização de Credenciais para Produção
- Antes do deploy em produção, é fundamental atualizar o arquivo `credentials.json` com as **chaves de API** necessárias:
  - **Mercado Pago:** Criar conta e gerar chaves de API.
  - **Google Cloud:** Configurar chaves para serviços como:
    - Google Maps (exibição do mapa do local).
    - Google Drive (armazenamento).
    - Google Sheets (gestão de dados).
- Foi utilizada a solução **Checkout Pro** do Mercado Pago para pagamentos, proporcionando:
  - Redirecionamento para a página do Mercado Pago.
  - Maior confiança na compra de presentes pelos convidados.

### 7. Configuração do Arquivo `config.json`
No arquivo `config.json`, insira as seguintes informações:
- Chaves de teste ou produção:
  - API do Mercado Pago.
  - API do Google Sheets.
- Endereço de redirecionamento após a compra de presente:
  - Este endereço precisa obrigatoriamente ser **HTTPS**.

---

### Estrutura do Repositório
- `appscriptgoogle`: Contém o script utilizado na integração com o Google Sheets.
- `credentials.json`: Arquivo para configuração das credenciais de APIs.
- `config.json`: Arquivo de configuração para integração de APIs e redirecionamento.

Vale destacar que algumas outras chaves ainda estarão dentro dos códigos. O ideal é separá-las para facilitar manutenção, para para funcionar o site, você poderá editar diretamente nos arquivos, como id de pasta no google drive, api do maps, etc.
```
