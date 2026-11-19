# Herramienta web de apoyo a la detección temprana del autismo

Plataforma web donde los padres de niños de 16 a 30 meses contestan el cuestionario M-CHAT-R y obtienen un nivel de riesgo con una recomendación; si lo desean, guardan el resultado y piden una cita de seguimiento con un psicólogo validado. **La plataforma no diagnostica.**

Proyecto de Ingeniería en Sistemas Computacionales (ESCOM-IPN). Node.js + Express, PostgreSQL y HTML/CSS/JS sin frameworks. Funciona por completo en local.

## Inicio rápido

```bash
npm install
cp .env.example .env        # llena tus datos de PostgreSQL
npm run bd:crear
npm run cargar-preguntas && npm run cargar-preguntas -- --test
npm run crear-admin
npm run dev                 # http://localhost:3000
```

`npm run tiempos` imprime los tiempos de respuesta para el artículo.

## Documentación

La explicación completa (arquitectura, base de datos, roles, algoritmos, seguridad, resultados y guion de demostración) está en [docs/GUIA_DEL_PROYECTO.md](docs/GUIA_DEL_PROYECTO.md).

---

M-CHAT-R/F™ © 2009 Diana Robins, Deborah Fein, & Marianne Barton. El texto del instrumento no se incluye en este repositorio (`bd/preguntas.json` está en `.gitignore`).
