//! Metrics endpoint tests for the MapoPass API.
//!
//! Verifies that the Prometheus metrics endpoint is working correctly.
//!
//! ## Running
//!
//! ```sh
//! # From passwords/api/:
//! cargo test --test metrics_tests --features test-helpers
//! ```

mod common;

use axum::body::Body;
use common::{app, body_string, run};
use http::{Request, StatusCode};
use tower::ServiceExt;

#[test]
fn test_metrics_endpoint() {
    run(async {
        // Make a request first so that metrics are recorded.
        let warmup = Request::builder()
            .method("GET")
            .uri("/api/v2/generate")
            .body(Body::empty())
            .unwrap();
        let warmup_res = app().oneshot(warmup).await.unwrap();
        assert_eq!(warmup_res.status(), StatusCode::OK);

        // Now fetch /metrics and verify the Prometheus exposition format.
        let req = Request::builder()
            .method("GET")
            .uri("/metrics")
            .body(Body::empty())
            .unwrap();
        let res = app().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let body = body_string(res).await;
        assert!(
            body.contains("axum_http_requests_total"),
            "expected axum_http_requests_total counter in /metrics response",
        );
        assert!(
            body.contains("axum_http_requests_duration_seconds"),
            "expected axum_http_requests_duration_seconds histogram in /metrics response",
        );
    });
}
