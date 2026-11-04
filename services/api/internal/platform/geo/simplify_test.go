package geo

import (
	"math"
	"testing"
)

func TestSimplifyStraightLine(t *testing.T) {
	pts := []Point{}
	for i := 0; i <= 100; i++ {
		pts = append(pts, Point{Lat: 37 + float64(i)*0.0001, Lon: 29})
	}
	idx := Simplify(pts, 1)
	if len(idx) != 2 || idx[0] != 0 || idx[1] != 100 {
		t.Fatalf("straight line should reduce to endpoints, got %v", idx)
	}
}

func TestSimplifyKeepsCorner(t *testing.T) {
	pts := []Point{{37, 29}, {37.001, 29}, {37.002, 29}, {37.002, 29.001}, {37.002, 29.002}}
	idx := Simplify(pts, 5)
	want := []int{0, 2, 4}
	if len(idx) != len(want) {
		t.Fatalf("got %v want %v", idx, want)
	}
	for i := range want {
		if idx[i] != want[i] {
			t.Fatalf("got %v want %v", idx, want)
		}
	}
}

func TestSimplifyMaxBounds(t *testing.T) {
	pts := []Point{}
	for i := 0; i < 5000; i++ {
		a := float64(i) / 50
		pts = append(pts, Point{Lat: 37 + 0.001*math.Sin(a), Lon: 29 + 0.001*math.Cos(a) + float64(i)*1e-6})
	}
	idx := SimplifyMax(pts, 1, 300)
	if len(idx) > 300 || len(idx) < 2 {
		t.Fatalf("len %d", len(idx))
	}
	if idx[0] != 0 || idx[len(idx)-1] != len(pts)-1 {
		t.Fatalf("endpoints not kept: %d..%d", idx[0], idx[len(idx)-1])
	}
	for i := 1; i < len(idx); i++ {
		if idx[i] <= idx[i-1] {
			t.Fatal("indices not ascending")
		}
	}
}

func TestSimplifyTiny(t *testing.T) {
	if got := Simplify(nil, 1); len(got) != 0 {
		t.Fatal(got)
	}
	if got := Simplify([]Point{{1, 1}}, 1); len(got) != 1 {
		t.Fatal(got)
	}
}
