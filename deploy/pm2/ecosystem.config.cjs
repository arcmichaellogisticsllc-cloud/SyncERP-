module.exports = {
  apps: [
    {
      name: "syncerp",
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PRODUCTION_MODE: "true",
        PORT: "8080"
      },
      max_memory_restart: "512M",
      time: true
    }
  ]
};
