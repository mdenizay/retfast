// Package geo holds geometry helpers: Douglas-Peucker route simplification on a
// local equirectangular projection (accurate to well under 1 % over a flight).
package geo

import "math"

// Point is a WGS84 coordinate.
type Point struct{ Lat, Lon float64 }

const earthR = 6371008.8

type xy struct{ x, y float64 }

func project(pts []Point) []xy {
	if len(pts) == 0 {
		return nil
	}
	lat0 := pts[0].Lat * math.Pi / 180
	k := math.Cos(lat0)
	out := make([]xy, len(pts))
	for i, p := range pts {
		out[i] = xy{x: p.Lon * math.Pi / 180 * earthR * k, y: p.Lat * math.Pi / 180 * earthR}
	}
	return out
}

func segDist(p, a, b xy) float64 {
	dx, dy := b.x-a.x, b.y-a.y
	if dx == 0 && dy == 0 {
		return math.Hypot(p.x-a.x, p.y-a.y)
	}
	t := ((p.x-a.x)*dx + (p.y-a.y)*dy) / (dx*dx + dy*dy)
	t = math.Max(0, math.Min(1, t))
	return math.Hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy))
}

// Simplify returns the indices (ascending) kept by Douglas-Peucker with the
// given tolerance in metres. First and last points are always kept.
func Simplify(pts []Point, tolM float64) []int {
	n := len(pts)
	if n <= 2 {
		idx := make([]int, n)
		for i := range idx {
			idx[i] = i
		}
		return idx
	}
	p := project(pts)
	keep := make([]bool, n)
	keep[0], keep[n-1] = true, true
	type span struct{ a, b int }
	stack := []span{{0, n - 1}}
	for len(stack) > 0 {
		s := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		maxD, maxI := -1.0, -1
		for i := s.a + 1; i < s.b; i++ {
			if d := segDist(p[i], p[s.a], p[s.b]); d > maxD {
				maxD, maxI = d, i
			}
		}
		if maxI >= 0 && maxD > tolM {
			keep[maxI] = true
			stack = append(stack, span{s.a, maxI}, span{maxI, s.b})
		}
	}
	out := make([]int, 0, n/4+2)
	for i, k := range keep {
		if k {
			out = append(out, i)
		}
	}
	return out
}

// SimplifyMax simplifies with increasing tolerance (starting at startTolM)
// until at most maxN points remain, then decimates uniformly as a last resort.
func SimplifyMax(pts []Point, startTolM float64, maxN int) []int {
	if maxN < 2 {
		maxN = 2
	}
	tol := startTolM
	if tol <= 0 {
		tol = 1
	}
	var idx []int
	for i := 0; i < 16; i++ {
		idx = Simplify(pts, tol)
		if len(idx) <= maxN {
			return idx
		}
		tol *= 2
	}
	out := make([]int, 0, maxN)
	step := float64(len(idx)-1) / float64(maxN-1)
	for i := 0; i < maxN; i++ {
		out = append(out, idx[int(math.Round(float64(i)*step))])
	}
	return out
}
