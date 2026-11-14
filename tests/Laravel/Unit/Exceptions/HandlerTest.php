<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Exceptions;

use App\Exceptions\Handler;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Exceptions\Handler as ExceptionHandler;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Illuminate\Validation\Validator;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Symfony\Component\HttpKernel\Exception\TooManyRequestsHttpException;
use Tests\Laravel\TestCase;

class HandlerTest extends TestCase
{
    private Handler $handler;

    protected function setUp(): void
    {
        parent::setUp();
        $this->handler = new Handler($this->app);
    }

    public function test_extends_base_exception_handler(): void
    {
        $this->assertInstanceOf(ExceptionHandler::class, $this->handler);
    }

    public function test_render_returns_json_for_authentication_exception(): void
    {
        $request = Request::create('/api/v2/test', 'GET');
        $exception = new AuthenticationException();

        $response = $this->handler->render($request, $exception);

        $this->assertInstanceOf(JsonResponse::class, $response);
        $this->assertEquals(401, $response->getStatusCode());

        $data = $response->getData(true);
        $this->assertEquals('AUTH_REQUIRED', $data['errors'][0]['code']);
    }

    public function test_render_returns_json_for_model_not_found(): void
    {
        $request = Request::create('/api/v2/test', 'GET');
        $exception = (new ModelNotFoundException())->setModel('App\\Models\\User');

        $response = $this->handler->render($request, $exception);

        $this->assertInstanceOf(JsonResponse::class, $response);
        $this->assertEquals(404, $response->getStatusCode());

        $data = $response->getData(true);
        $this->assertEquals('NOT_FOUND', $data['errors'][0]['code']);
        $this->assertStringContainsString('User', $data['errors'][0]['message']);
    }

    public function test_render_returns_json_for_not_found_http_exception(): void
    {
        $request = Request::create('/api/v2/test', 'GET');
        $exception = new NotFoundHttpException();

        $response = $this->handler->render($request, $exception);

        $this->assertInstanceOf(JsonResponse::class, $response);
        $this->assertEquals(404, $response->getStatusCode());

        $data = $response->getData(true);
        $this->assertEquals('NOT_FOUND', $data['errors'][0]['code']);
    }

    public function test_render_returns_json_for_rate_limit_exception(): void
    {
        $request = Request::create('/api/v2/test', 'GET');
        $exception = new TooManyRequestsHttpException(60);

        $response = $this->handler->render($request, $exception);

        $this->assertInstanceOf(JsonResponse::class, $response);
        $this->assertEquals(429, $response->getStatusCode());

        $data = $response->getData(true);
        $this->assertEquals('RATE_LIMIT_EXCEEDED', $data['errors'][0]['code']);
    }

    public function test_render_returns_json_for_forbidden_http_exception(): void
    {
        $request = Request::create('/api/v2/test', 'GET');
        $exception = new HttpException(403, 'Forbidden');

        $response = $this->handler->render($request, $exception);

        $this->assertInstanceOf(JsonResponse::class, $response);
        $this->assertEquals(403, $response->getStatusCode());

        $data = $response->getData(true);
        $this->assertEquals('FORBIDDEN', $data['errors'][0]['code']);
    }

    public function test_render_returns_json_for_method_not_allowed(): void
    {
        $request = Request::create('/api/v2/test', 'GET');
        $exception = new HttpException(405, 'Method Not Allowed');

        $response = $this->handler->render($request, $exception);

        $this->assertEquals(405, $response->getStatusCode());

        $data = $response->getData(true);
        $this->assertEquals('METHOD_NOT_ALLOWED', $data['errors'][0]['code']);
    }

    public function test_render_returns_json_for_validation_exception(): void
    {
        $request = Request::create('/api/v2/test', 'POST');

        $validator = \Illuminate\Support\Facades\Validator::make(
            ['email' => 'not-an-email'],
            ['email' => 'required|email']
        );

        $exception = new ValidationException($validator);

        $response = $this->handler->render($request, $exception);

        $this->assertInstanceOf(JsonResponse::class, $response);
        $this->assertEquals(422, $response->getStatusCode());

        $data = $response->getData(true);
        $this->assertArrayHasKey('errors', $data);
        $this->assertEquals('VALIDATION_ERROR', $data['errors'][0]['code']);
        $this->assertEquals('email', $data['errors'][0]['field']);
    }

    public function test_render_returns_500_for_generic_exception(): void
    {
        $request = Request::create('/api/v2/test', 'GET');
        $exception = new \RuntimeException('Something broke');

        $response = $this->handler->render($request, $exception);

        $this->assertInstanceOf(JsonResponse::class, $response);
        $this->assertEquals(500, $response->getStatusCode());

        $data = $response->getData(true);
        $this->assertEquals('SERVER_ERROR', $data['errors'][0]['code']);
        $this->assertEquals('Something went wrong on our side. Please try again.', $data['errors'][0]['message']);
    }

    public function test_render_includes_debug_info_in_debug_mode(): void
    {
        config(['app.debug' => true]);

        $request = Request::create('/api/v2/test', 'GET');
        $exception = new \RuntimeException('Debug test');

        $response = $this->handler->render($request, $exception);
        $data = $response->getData(true);

        $this->assertArrayHasKey('debug', $data);
        $this->assertEquals('RuntimeException', $data['debug']['exception']);
        $this->assertEquals('Debug test', $data['debug']['message']);
    }

    public function test_render_hides_debug_info_in_production(): void
    {
        config(['app.debug' => false]);

        $request = Request::create('/api/v2/test', 'GET');
        $exception = new \RuntimeException('Secret error');

        $response = $this->handler->render($request, $exception);
        $data = $response->getData(true);

        $this->assertArrayNotHasKey('debug', $data);
        $this->assertStringNotContainsString('Secret error', json_encode($data));
    }

    public function test_dont_flash_contains_password_fields(): void
    {
        $reflection = new \ReflectionProperty($this->handler, 'dontFlash');
        $reflection->setAccessible(true);
        $dontFlash = $reflection->getValue($this->handler);

        $this->assertContains('current_password', $dontFlash);
        $this->assertContains('password', $dontFlash);
        $this->assertContains('password_confirmation', $dontFlash);
    }

    public function test_should_return_json_always_returns_true(): void
    {
        $request = Request::create('/api/v2/test', 'GET');
        $exception = new \RuntimeException('test');

        $reflection = new \ReflectionMethod($this->handler, 'shouldReturnJson');
        $reflection->setAccessible(true);

        $this->assertTrue($reflection->invoke($this->handler, $request, $exception));
    }
}
