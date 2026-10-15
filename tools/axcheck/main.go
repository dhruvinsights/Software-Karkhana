// Copyright 2026 Software Karkhana authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Command axcheck validates a multi-document AX manifest (Task, Workspace,
// Model) against google/ax's own types and validators, the same ones
// `ax apply` and the AX API server use. It reads YAML from stdin and prints a
// JSON report. Exit code 0 means every document is valid.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/google/ax/pkg/apis/v1alpha1"
	"gopkg.in/yaml.v3"
)

type result struct {
	Index int    `json:"index"`
	Kind  string `json:"kind"`
	Name  string `json:"name"`
	OK    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

type report struct {
	OK      bool     `json:"ok"`
	Results []result `json:"results"`
}

func check(doc *yaml.Node, index int) result {
	var head struct {
		Kind string `yaml:"kind"`
	}
	if err := doc.Decode(&head); err != nil {
		return result{Index: index, Error: err.Error()}
	}
	r := result{Index: index, Kind: head.Kind}
	var err error
	switch head.Kind {
	case v1alpha1.KindTask:
		var t v1alpha1.Task
		if err = doc.Decode(&t); err == nil {
			r.Name = t.GetMetadata().GetName()
			err = v1alpha1.ValidateTask(&t)
		}
	case v1alpha1.KindWorkspace:
		var w v1alpha1.Workspace
		if err = doc.Decode(&w); err == nil {
			r.Name = w.GetMetadata().GetName()
			err = v1alpha1.ValidateWorkspace(&w)
		}
	case v1alpha1.KindModel:
		var m v1alpha1.Model
		if err = doc.Decode(&m); err == nil {
			r.Name = m.GetMetadata().GetName()
			err = v1alpha1.ValidateModel(&m)
		}
	case "":
		err = errors.New("missing kind")
	default:
		err = fmt.Errorf("unsupported kind %q (expected Task, Workspace, or Model)", head.Kind)
	}
	if err != nil {
		r.Error = err.Error()
		return r
	}
	r.OK = true
	return r
}

func main() {
	data, err := io.ReadAll(os.Stdin)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	rep := report{OK: true, Results: []result{}}
	dec := yaml.NewDecoder(bytes.NewReader(data))
	for i := 1; ; i++ {
		var doc yaml.Node
		if err := dec.Decode(&doc); err != nil {
			if errors.Is(err, io.EOF) {
				break
			}
			rep.OK = false
			rep.Results = append(rep.Results, result{Index: i, Error: err.Error()})
			break
		}
		if doc.Kind == 0 || (doc.Kind == yaml.DocumentNode && len(doc.Content) == 0) {
			continue
		}
		r := check(&doc, i)
		rep.OK = rep.OK && r.OK
		rep.Results = append(rep.Results, r)
	}
	if len(rep.Results) == 0 {
		rep.OK = false
		rep.Results = append(rep.Results, result{Error: "empty manifest"})
	}
	_ = json.NewEncoder(os.Stdout).Encode(rep)
	if !rep.OK {
		os.Exit(1)
	}
}
