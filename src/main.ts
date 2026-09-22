import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { WafMiddleware } from './common/middleware/waf.middleware';
import { RateLimiterMiddleware } from './common/middleware/rate-limiter.middleware';
import { CsrfMiddleware } from './common/middleware/csrf.middleware';
import { SanitizeInputInterceptor } from './common/interceptors/sanitize-input.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalFilters(new AllExceptionsFilter());
  app.setGlobalPrefix('api');

  // ==========================================
  // 1. SECURITY HEADERS (HSTS, Anti-Clickjacking, XSS, MIME Sniffing, COOP, CORP, COEP)
  // ==========================================
  app.use((req: any, res: any, next: any) => {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    );
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self' http: https: data: blob: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'none';",
    );
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.removeHeader('X-Powered-By');
    next();
  });

  // ==========================================
  // 2. KONFIGURASI CORS KETAT (Cross-Origin Protection)
  // ==========================================
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:4173',
    'https://casheva.store',
  ];

  app.enableCors({
    origin: (origin, callback) => {
      // Izinkan request tanpa origin (seperti curl, mobile app, postman dev) atau jika origin terdaftar
      if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
        callback(null, true);
      } else {
        callback(new Error('Akses diblokir oleh kebijakan CORS Casheva'));
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-CSRF-Token',
      'satminkal-id',
      'Accept',
    ],
    credentials: true,
  });

  // ==========================================
  // 3. WAF & RATE LIMITER & CSRF PROTECTION MIDDLEWARE
  // ==========================================
  const waf = new WafMiddleware();
  const rateLimiter = new RateLimiterMiddleware();
  const csrf = new CsrfMiddleware();

  app.use((req: any, res: any, next: any) => waf.use(req, res, next));
  app.use((req: any, res: any, next: any) => rateLimiter.use(req, res, next));
  app.use((req: any, res: any, next: any) => csrf.use(req, res, next));

  // ==========================================
  // 4. GLOBAL DATA SANITIZATION & VALIDATION PIPE
  // ==========================================
  app.useGlobalInterceptors(new SanitizeInputInterceptor());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // ==========================================
  // KONFIGURASI SWAGGER (OPENAPI)
  // ==========================================
  const config = new DocumentBuilder()
    .setTitle('API Koperasi Simpan Pinjam TNI AD')
    .setDescription(
      'Dokumentasi REST API Sistem Informasi Koperasi Simpan Pinjam (Lomba RTI 2026). ' +
      'Mendukung fitur Multi-Tenant/Session Kotama & Satminkal, Simpanan, Pinjaman, dan SHU.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Masukkan Token JWT hasil dari Login',
        in: 'header',
      },
      'JWT-auth', // Key nama auth yang dipasang di controller
    )
    .build();

  const customCss = `
    /* Ubah warna & styling tombol Authorize utama saat terautentikasi */
    .swagger-ui .btn.authorize.locked {
      background-color: #10B981 !important;
      border-color: #10B981 !important;
      color: #FFFFFF !important;
      font-weight: bold !important;
    }
    .swagger-ui .btn.authorize.locked svg {
      fill: #FFFFFF !important;
    }

    /* Ubah ikon gembok pada setiap endpoint saat terautentikasi menjadi gembok TERBUKA (UNLOCK) */
    .swagger-ui .authorization__btn.locked svg {
      fill: #10B981 !important;
      filter: drop-shadow(0px 0px 3px rgba(16, 185, 129, 0.5));
    }
    
    /* Ganti path SVG gembok tertutup menjadi SVG gembok TERBUKA (Unlocked Padlock) */
    .swagger-ui .authorization__btn.locked svg path {
      d: path("M9 11V7a5 5 0 0110 0v4m-3 0h-4a2 2 0 00-2 2v7a2 2 0 002 2h8a2 2 0 002-2v-7a2 2 0 00-2-2h-4z") !important;
    }

    .swagger-ui .authorization__btn.locked {
      opacity: 1 !important;
    }
  `;

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
    customCss,
    customSiteTitle: 'Casheva Koperasi - API Documentation',
  });

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 Application is running on: http://localhost:${port}`);
  console.log(
    `📚 Swagger OpenAPI Docs available on: http://localhost:${port}/api/docs`,
  );
}
void bootstrap();
