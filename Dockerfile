# Use uma imagem Node.js como base
FROM node:14

# Crie e defina o diretório de trabalho
WORKDIR /usr/src/app

# Copie o package.json e package-lock.json
COPY package*.json ./

# Instale as dependências
RUN npm install -g gulp
RUN npm install

# Copie o restante dos arquivos
COPY . .

# Exponha a porta que a aplicação usará
EXPOSE 8080

# Comando para rodar a aplicação
CMD ["gulp"]
